# DaySponsor — Auction & Payment Implementation Contract

> **Status: DRAFT (Engineer B)**
>
> This document is the **proposed** contract for the auction, bidding, and payment
> subsystems. It is written by Engineer B (Stripe / UI) because the auction schema did
> not exist on `main` when this work started. Engineer A owns the migrations and RPCs
> and **must review this before implementing it**.
>
> Engineer B will code against this document. If Engineer A changes a name, shape, or
> RPC signature, Engineer B will update the temporary application types in
> `lib/auction-types.ts` (which exist *only* because generated database types are not
> yet available) and the calling code.
>
> **Rule that must never be violated:** the application never trusts the browser for a
> financial amount, a currency, a winner, or a payout. The database is authoritative.

---

## 1. Design constraints

These are hard constraints that any implementation must satisfy:

1. **Integer minor units.** All money is stored as a Postgres `bigint`/`integer` in the
   smallest currency unit (e.g. `450` = €4.50). No `numeric`/`float` money columns, no
   client-side rounding. Currency is fixed per slot and is **not** accepted from the
   client.
2. **Server-authoritative state.** Bids, winner selection, payment status, and payout
   release are set by RPCs or by service-role server writes — never by a browser
   Supabase client using an RLS-permitted `update`.
3. **Atomic bidding.** A bid must be a single server-side atomic operation that
   re-checks the current highest bid and the auction deadline inside the transaction.
   Optimistic UI updates are display-only.
4. **Payment is confirmed only by a verified Stripe webhook**, never by the browser
   success/cancel redirect.
5. **Payout is a separate, later operation** from payment. Funds land on the platform
   first (platform charge, or charge with `transfer_group`), and the creator transfer is
   released only after fulfillment conditions are met.
6. **Payout amount is independent of review rating.** A 1-star review and a 5-star
   review must produce an identical `creator_amount`.
7. **Idempotency everywhere.** Financial creation calls carry a stable Stripe
   idempotency key; webhook events are de-duplicated by event id; transfers are
   de-duplicated by a database uniqueness constraint.

---

## 2. Naming conventions

- Table names: `snake_case`, plural.
- Status/type columns: `text` with a `CHECK` constraint, never a bare enum (matches the
  existing schema style in
  `supabase/migrations/20260903215330_create_daysponsor_schema.sql`).
- Money columns: `<thing>_amount` in minor units, plus a sibling `<thing>_currency`
  where a row can cross currencies.
- Timestamps: `timestamptz`, `DEFAULT now()`. Deadline/payout columns end in `_at`.
- Stripe identifiers: `stripe_<object>_id` (matches existing
  `stripe_payment_intent_id`, `stripe_checkout_session_id`).

---

## 3. Schema additions

All of the following are **requests**. Engineer A owns the final SQL. See
`docs/database-change-requests.md` for the consolidated, prioritized list.

### 3.1 `sponsorship_slots` — auction fields

The existing `sponsorship_slots` table is fixed-price (`price integer NOT NULL`) with a
boolean `is_available`. Auction behaviour needs more state than a boolean can carry.

```sql
ALTER TABLE sponsorship_slots
  -- Money. starting_price replaces price as the auction reserve / opening bid.
  ADD COLUMN IF NOT EXISTS starting_price bigint NOT NULL DEFAULT 0,
  -- Absolute auction close time (UTC). NULL while the slot is not yet listed for auction.
  ADD COLUMN IF NOT EXISTS auction_ends_at timestamptz,
  -- Auction lifecycle, distinct from the parent day's status.
  ADD COLUMN IF NOT EXISTS auction_status text NOT NULL DEFAULT 'not_listed'
    CHECK (auction_status IN (
      'not_listed',      -- created, not open for bidding
      'open',            -- accepting bids
      'closing',         -- deadline reached, winner being resolved (short window)
      'awaiting_payment',-- a winning bid is selected and unpaid
      'payment_pending', -- checkout session created for the winning bid
      'sold',            -- paid
      'expired',         -- no valid bids and the deadline passed
      'cancelled'
    )),
  -- Denormalized, maintained ONLY by RPC, for fast display. Never written by the client.
  ADD COLUMN IF NOT EXISTS current_highest_bid bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_highest_bidder_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bid_count integer NOT NULL DEFAULT 0,
  -- How many times the slot has moved to a fallback winner.
  ADD COLUMN IF NOT EXISTS winner_attempts integer NOT NULL DEFAULT 0;
```

Backfill: `starting_price := price`, then `price` is **dropped** (or kept as a nullable
deprecated column for one release) so that no code path can read a stale fixed price.

`sponsorship_slots.is_available` is retained for compatibility but is **no longer the
source of truth** for auction state; `auction_status` is.

### 3.2 `auction_bids`

Every bid, kept forever for audit and dispute resolution. **Row-level security: the
browser may only read aggregate/own rows** (see §6).

```sql
CREATE TABLE IF NOT EXISTS auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES sponsorship_slots(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- The creator who owns the slot at bid time, denormalized for fast creator queries.
  creator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'eur',
  -- 'pending' (active in the running auction)
  -- 'winning'  (currently the selected winning bid)
  -- 'outbid'   (superseded by a higher bid)
  -- 'won'      (won AND paid)
  -- 'lost'     (auction closed and this bid did not win)
  -- 'payment_pending' (checkout session created for this bid)
  -- 'payment_failed'  (checkout expired or payment failed)
  -- 'expired'  (was winning, payment deadline lapsed without payment)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','winning','outbid','won','lost','payment_pending','payment_failed','expired')),
  stripe_checkout_session_id text,
  payment_deadline_at timestamptz,
  placed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, brand_id, amount, placed_at)
);

CREATE INDEX IF NOT EXISTS idx_auction_bids_slot_id ON auction_bids(slot_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_slot_status ON auction_bids(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_bids_brand_status ON auction_bids(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_bids_creator_status ON auction_bids(creator_id, status);
```

**Only one bid per slot may hold a "paying" status.** Enforced by the partial unique
index in §3.6.

### 3.3 `sponsorships` — payment & payout fields

The existing table already has `amount`, `platform_fee`, `creator_amount`, and Stripe id
columns. Extend it:

```sql
ALTER TABLE sponsorships
  -- The bid this sponsorship was created from. NULL only for legacy fixed-price rows.
  ADD COLUMN IF NOT EXISTS winning_bid_id uuid REFERENCES auction_bids(id) ON DELETE SET NULL,
  -- Currency, fixed at auction-listing time.
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'eur',
  -- Payment deadline for the winning bidder (drives the expirer job).
  ADD COLUMN IF NOT EXISTS payment_deadline_at timestamptz,
  -- When the webhook confirmed payment. updated_at is not sufficient.
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  -- Payout / transfer state. NULL until a transfer is attempted.
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text,
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'none'
    CHECK (payout_status IN ('none','pending','released','failed','reversed','on_hold')),
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz,
  -- Refund state.
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none','pending','succeeded','failed','canceled')),
  -- Admin-controlled hold that blocks payout release regardless of other conditions.
  ADD COLUMN IF NOT EXISTS payout_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_hold_reason text;
```

Add a CHECK that the money always balances: `amount = platform_fee + creator_amount`.

### 3.4 `webhook_events`

Stripe event idempotency + audit trail. Written by the service role only; the browser
never touches it.

```sql
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,   -- evt_...  <-- the idempotency key
  stripe_account_id text,                 -- acct_... for Connect events
  event_type text NOT NULL,               -- e.g. checkout.session.completed
  api_version text,
  -- 'pending'  : received, processing started
  -- 'processed': the handler finished successfully
  -- 'failed'   : handler threw; safe to retry
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','processed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status, created_at);
```

Idempotency contract: the webhook handler inserts a row keyed on `stripe_event_id`. If
the insert conflicts **and the existing row is `processed`**, return 2xx immediately
without re-executing side effects. If it conflicts and the row is `pending`/`failed`,
re-run the handler.

### 3.5 `notifications`

The current in-app notification mechanism is shadcn toast + sonner, which is ephemeral.
Persistent, reviewable notifications need a table. The **toast remains the delivery
mechanism**; this table is the record.

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,          -- see §7 for the allowed set
  title text NOT NULL,
  body text,
  -- Optional deep link, e.g. /dashboard/brand?tab=payment
  href text,
  -- The thing that caused it, for de-duplication and for "mark all read".
  related_type text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, type, related_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read
  ON notifications(recipient_id, read_at, created_at DESC);
```

### 3.6 Required partial unique indexes

These are the load-bearing correctness constraints. They are what makes the system
safe to run without a global lock:

```sql
-- Exactly one winning/paying bid per slot.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slot_paying_bid
  ON auction_bids(slot_id)
  WHERE status IN ('winning', 'payment_pending');

-- Exactly one open unpaid sponsorship per slot. Prevents double-selling a slot.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slot_unpaid_sponsorship
  ON sponsorships(slot_id)
  WHERE status IN ('pending', 'paid')
    AND refund_status IN ('none', 'pending');

-- At most one successful transfer per sponsorship. Prevents double payout.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sponsorship_released_transfer
  ON sponsorships(id)
  WHERE payout_status = 'released';

-- At most one open refund per sponsorship.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sponsorship_open_refund
  ON sponsorships(id)
  WHERE refund_status IN ('pending');
```

---

## 4. RPCs (owned by Engineer A)

Engineer B calls these. Signatures are proposals; names must be agreed. All money is
minor units; **no RPC accepts a currency or a final amount from the caller unless
explicitly stated**.

### 4.1 `place_bid`

Atomic bid placement. This is the atomic bidding function the spec requires.

```text
place_bid(
  p_slot_id       uuid,
  p_brand_id      uuid,   -- validated server-side against the caller's profile
  p_amount        bigint  -- minor units; MUST be > current_highest_bid + min_increment
) RETURNS TABLE (
  bid_id            uuid,
  status            text,   -- 'winning' | 'outbid'
  current_highest_bid bigint,
  previous_bidder_id uuid,  -- for the outbid notification; NULL if none
  auction_ends_at   timestamptz,
  error_code        text    -- NULL on success
)
```

Error codes: `auction_not_open`, `auction_ended`, `bid_too_low`, `own_slot`,
`not_brand_role`, `slot_unavailable`, `deadline_passed`.

Inside one transaction the RPC must: `SELECT ... FOR UPDATE` the slot, re-check
`auction_status = 'open'` and `now() < auction_ends_at`, compare `p_amount` against
`current_highest_bid`, insert the bid, demote the previous high bidder to `outbid`, set
the new bid to `winning`, update the denormalized slot counters, and commit. On any
failure the whole thing rolls back.

If the auction deadline has passed the RPC **must** return `auction_ended` rather than
silently accepting — the client uses this to trigger a refetch, and the closing job is
the only thing that transitions `open → closing/awaiting_payment`.

### 4.2 Auction lifecycle RPCs (called by cron, not by the browser)

```text
close_expired_auctions(p_batch_size int DEFAULT 100)
  → finds slots with auction_status='open' AND auction_ends_at <= now()
    transitions them toward awaiting_payment; selects the highest valid bid.
    Returns the number of slots processed.

expire_unpaid_winners(p_deadline_hours int DEFAULT 24, p_batch_size int DEFAULT 100)
  → slots with a winning bid whose payment_deadline_at <= now()
    marks the bid 'expired', bumps sponsorship_slots.winner_attempts,
    returns count advanced.

advance_to_fallback_winner(p_slot_id uuid, p_max_attempts int DEFAULT 3)
  → moves the slot to the next-highest valid bid, if any. Returns the new
    winning bid id or NULL.

reconcile_payment_state(p_batch_size int DEFAULT 100)
  → for sponsorships stuck in 'pending'/'payment_pending' whose checkout
    session is known, asks Stripe (via a server callback, see §4.5) for the
    authoritative session/payment-intent status and corrects local state.
```

### 4.3 Payment state RPCs (called only by the verified webhook handler)

```text
mark_sponsorship_paid(
  p_sponsorship_id     uuid,
  p_checkout_session_id text,
  p_payment_intent_id   text,
  p_amount              bigint,   -- minor units, compared against sponsorships.amount
  p_currency            text      -- compared against sponsorships.currency
) RETURNS TABLE (ok boolean, error_code text)
```

This is the **only** place that flips a sponsorship to `paid`. It must verify
`p_amount = sponsorships.amount AND p_currency = sponsorships.currency` inside the
transaction and refuse otherwise (`amount_mismatch`). On success it also marks the
winning bid `won`, the slot `sold`, sets `paid_at`, and records both Stripe ids.

```text
mark_payment_failed(p_sponsorship_id uuid, p_reason text)
mark_checkout_expired(p_sponsorship_id uuid)
mark_refund_state(p_sponsorship_id uuid, p_refund_id text, p_status text, p_amount bigint)
record_transfer(
  p_sponsorship_id uuid, p_transfer_id text, p_amount bigint, p_currency text
) RETURNS TABLE (ok boolean, error_code text)   -- guarded by uniq index §3.6
record_transfer_failure(p_sponsorship_id uuid, p_transfer_id text, p_code text, p_message text)
```

### 4.4 Read-only dashboard RPCs

```text
get_brand_bids(p_brand_id uuid)         → active/winning/outbid/ended rows
get_creator_auctions(p_creator_id uuid) → slot + auction + winning-bid summary
get_admin_auction_overview()            → auctions, bids, payments, transfers, refunds
get_platform_revenue()                  → fees collected, transferred, pending
```

### 4.5 The Stripe-call boundary

RPCs **must not** make outbound HTTPS calls to Stripe (they run as SQL). Any
reconciliation that needs Stripe goes through this contract instead:

```text
-- Engineer B's server code calls this to hand a resolution back to the DB:
queue_stripe_reconcile(p_sponsorship_id uuid, p_kind text)
  → inserts into a tiny stripe_reconcile_queue table (Engineer B polls or cron drains it)
```

If Engineer A prefers, `reconcile_payment_state` may instead be implemented as a pure
**read** RPC returning the rows that need a Stripe check, with Engineer B applying the
correction through `mark_sponsorship_paid` / `mark_payment_failed`. Either is acceptable;
pick one and record it here.

---

## 5. Configuration values

```text
AUCTION_PAYMENT_DEADLINE_HOURS   default 24   (env override, see .env.example)
AUCTION_MAX_WINNER_ATTEMPTS      default 3
AUCTION_MIN_BID_INCREMENT        default 50 minor units (€0.50)
PLATFORM_FEE_BPS                 default 1000 (10%)
```

The platform fee is computed **server-side** from `PLATFORM_FEE_BPS` at checkout time
and stored; the stored `platform_fee` and `creator_amount` are what the payout uses, so
a later fee change never retroactively alters a deal.

---

## 6. RLS policy requirements

The browser Supabase client must be able to:

- **Read** `sponsorship_slots` (all listed slots, with auction fields).
- **Read own** `auction_bids` rows (`brand_id = auth.uid()`-equivalent profile).
- **Read** `current_highest_bid`, `bid_count`, `auction_ends_at`, `auction_status` from
  `sponsorship_slots` — this is public auction state.
- **Not read** other brands' bid rows. The "do not expose losing brand identities" rule
  means the client-facing queries must expose only aggregate counts plus the caller's
  own bids. Where the client needs "am I winning", expose that as a derived boolean on
  the caller's own row, not as a list of other bidders.
- **Not read** `webhook_events` at all (service role only).
- **Read own** `notifications`; update `read_at` on own rows only.
- **Not write** `auction_bids.status`, `sponsorship_slots.current_highest_bid`,
  `bid_count`, `auction_status`, or any `payout_*` / `refund_*` column. Those columns
  are written exclusively by service-role server code and RPCs.

The client places bids by **calling the `place_bid` RPC** (or Engineer B's authenticated
server wrapper around it), never by inserting into `auction_bids` directly.

---

## 7. Notification types

The persistent notification table stores these `type` values. Toast is the delivery
mechanism; failure to deliver a toast or notification **must not** roll back a
successful financial transaction (notifications are fire-and-forget, queued after the
commit).

```text
bid_accepted        outbid           auction_ended
winner_selected     payment_required payment_expiring
payment_successful  product_shipped  product_received
review_pending      review_published payout_released
refund_completed    fallback_selected
```

---

## 8. Currency

- The platform currency is **EUR**, fixed by configuration (`PLATFORM_CURRENCY`, default
  `eur`).
- `currency` columns are set at slot-listing time and are immutable for the slot's life.
- The client **never** sends a currency. The Checkout Session currency comes from the
  slot.
- Amounts are formatted for display using `Intl.NumberFormat` with `style: 'currency'`
  and the slot's currency, converting minor units by dividing by 100.

---

## 9. Open questions for Engineer A

1. Confirm the `place_bid` return shape (§4.1) — specifically whether you prefer a
   composite return type or a JSONB `result` column. Engineer B will match whatever you
   choose.
2. Confirm §4.5: does `reconcile_payment_state` make the Stripe call (rejected — SQL
   can't do outbound HTTPS cleanly) or does it return rows for Engineer B to reconcile?
3. Should `auction_bids` keep a `currency` column, or is slot-level `currency` enough?
4. Confirm whether `sponsorship_slots.price` is dropped or kept nullable-deprecated.
5. The `notifications` table is new. If you already have a notification design, that one
   wins and Engineer B will drop §3.5.
