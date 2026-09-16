# DaySponsor — Database Change Requests

> **Engineer B → Engineer A.**
>
> Engineer B does **not** write migrations. Every schema change Engineer B needs is
> registered here, in priority order, with the exact DDL Engineer B expects and the
> reason it is required.
>
> Engineer A: please implement in this order. Items 1–4 block the auction and payment
> flows; item 5 blocks persistent notifications; item 6 is correctness hardening that can
> land later.
>
> Status legend: ⬜ requested · 🟡 in progress · ✅ merged · ❌ rejected/changed

---

## Priority order

| # | Change | Blocks | Status |
|---|---|---|---|
| 1 | Auction fields on `sponsorship_slots` | bidding UI, closing job | ⬜ |
| 2 | New `auction_bids` table | bidding, dashboards | ⬜ |
| 3 | Payment/payout/refund fields on `sponsorships` + `webhook_events` | checkout, webhooks, payouts, refunds | ⬜ |
| 4 | RPCs (`place_bid` + lifecycle/payment/read) | every financial flow and cron job | ⬜ |
| 5 | New `notifications` table | persistent notifications | ⬜ |
| 6 | Partial unique indexes (double-sell / double-payout guards) | correctness; safe to ship after 1–3 | ⬜ |

The authoritative shapes, RPC signatures, error codes, and RLS requirements live in
**`docs/auction-implementation-contract.md`** (§3, §4, §6). That document is the spec;
this one is the work queue.

---

## 1. Auction fields on `sponsorship_slots`  ⬜

**Why:** the existing `price integer NOT NULL` + `is_available boolean` model cannot
express an auction (no deadline, no current bid, no lifecycle beyond available/taken).

```sql
ALTER TABLE sponsorship_slots
  ADD COLUMN IF NOT EXISTS starting_price bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auction_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS auction_status text NOT NULL DEFAULT 'not_listed'
    CHECK (auction_status IN (
      'not_listed','open','closing','awaiting_payment','payment_pending','sold','expired','cancelled'
    )),
  ADD COLUMN IF NOT EXISTS current_highest_bid bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_highest_bidder_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bid_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS winner_attempts integer NOT NULL DEFAULT 0;

-- Backfill, then drop or deprecate `price`.
UPDATE sponsorship_slots SET starting_price = price WHERE starting_price = 0;
-- ALTER TABLE sponsorship_slots DROP COLUMN IF EXISTS price;   -- confirm before dropping
```

**Migration notes**
- Backfill `starting_price := price` first, then drop `price`. If you prefer to keep
  `price` nullable-deprecated for one release, say so and Engineer B will stop reading
  it. Until told otherwise Engineer B treats `starting_price` as the sole source of
  truth.
- `current_highest_bid`, `current_highest_bidder_id`, `bid_count`, `auction_status` are
  **maintained only by RPC / service role**. RLS must deny client writes (contract §6).
- On delete of `current_highest_bidder_id`'s profile, `ON DELETE SET NULL` is intentional
  — the auction state survives a deleted bidder, the closing job resolves a new winner.

---

## 2. New `auction_bids` table  ⬜

**Why:** bids must be retained forever (audit, disputes, "failed winner attempts" admin
view) and must be queryable per-brand and per-creator for the dashboards.

```sql
CREATE TABLE IF NOT EXISTS auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES sponsorship_slots(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending','winning','outbid','won','lost','payment_pending','payment_failed','expired'
    )),
  stripe_checkout_session_id text,
  payment_deadline_at timestamptz,
  placed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, brand_id, amount, placed_at)
);

CREATE INDEX IF NOT EXISTS idx_auction_bids_slot_id        ON auction_bids(slot_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_slot_status    ON auction_bids(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_bids_brand_status   ON auction_bids(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_bids_creator_status ON auction_bids(creator_id, status);
```

**Migration notes**
- `creator_id` is denormalized at bid time deliberately: creator-dashboard queries must
  not need to join through slots + days to find their auctions.
- The `UNIQUE (slot_id, brand_id, amount, placed_at)` constraint is a replay guard, not a
  one-bid-per-brand limit. Re-bidding higher is allowed; the RPC handles the transition.
- Currency defaults to `'eur'` but is copied from the slot at bid time. See open question
  3 in the contract — if slot-level currency suffices this column can be dropped.

---

## 3. `sponsorships` payment/payout fields + `webhook_events`  ⬜

**Why:** sponsorship rows today carry payment ids but no payout state, no refund state,
no payment deadline, and no `paid_at`. Webhook idempotency needs a dedicated table.

### 3a. `sponsorships`

```sql
ALTER TABLE sponsorships
  ADD COLUMN IF NOT EXISTS winning_bid_id uuid REFERENCES auction_bids(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'eur',
  ADD COLUMN IF NOT EXISTS payment_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text,
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'none'
    CHECK (payout_status IN ('none','pending','released','failed','reversed','on_hold')),
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none','pending','succeeded','failed','canceled')),
  ADD COLUMN IF NOT EXISTS payout_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_hold_reason text;

ALTER TABLE sponsorships
  ADD CONSTRAINT sponsorships_money_balances
    CHECK (amount = platform_fee + creator_amount);
```

**Migration notes**
- `amount = platform_fee + creator_amount` is a hard invariant the payout logic depends
  on. Please confirm it does not break existing rows (all current rows are inserted by
  the client with `creator_amount = price - round(price*0.1)`, so it should hold; if any
  legacy row violates it, fix the data before adding the constraint).
- `currency` default is only for legacy rows; new sponsorships copy the slot currency.
- `stripe_transfer_id` / `stripe_refund_id` are nullable and only ever written by
  service-role code.

### 3b. `webhook_events`

```sql
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  stripe_account_id text,
  event_type text NOT NULL,
  api_version text,
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

**Migration notes**
- `stripe_event_id` is `UNIQUE` — that column **is** the idempotency key. The webhook
  handler does `INSERT … ON CONFLICT (stripe_event_id) DO NOTHING` / upsert and uses the
  resulting row state to decide whether to execute side effects.
- `last_error` must be safe to store: Engineer B sanitizes it before writing (no card
  data, no client secrets, no raw payload).
- RLS: **no client access at all.** Service role only.

---

## 4. RPCs  ⬜

**Why:** atomic bidding and winner selection cannot be done safely from application code
with RLS-permitted updates; payment/payout state transitions must be atomic and
single-writer.

Full signatures, return shapes, and error codes are in
`docs/auction-implementation-contract.md` §4. Requested in this order:

```text
4.1 place_bid(p_slot_id, p_brand_id, p_amount)        — atomic bid (blocks the day UI)
4.2 close_expired_auctions(p_batch_size)
     expire_unpaid_winners(p_deadline_hours, p_batch_size)
     advance_to_fallback_winner(p_slot_id, p_max_attempts)   — cron-only
     reconcile_payment_state(p_batch_size)                   — see note below
4.3 mark_sponsorship_paid(p_sponsorship_id, p_checkout_session_id,
                          p_payment_intent_id, p_amount, p_currency)
     mark_payment_failed(p_sponsorship_id, p_reason)
     mark_checkout_expired(p_sponsorship_id)
     mark_refund_state(p_sponsorship_id, p_refund_id, p_status, p_amount)
     record_transfer(p_sponsorship_id, p_transfer_id, p_amount, p_currency)
     record_transfer_failure(p_sponsorship_id, p_transfer_id, p_code, p_message)
4.4 get_brand_bids(p_brand_id)
     get_creator_auctions(p_creator_id)
     get_admin_auction_overview()
     get_platform_revenue()
```

**Important — SQL cannot call Stripe.** `reconcile_payment_state` must not make an
outbound HTTPS call. Two acceptable designs, pick one and record it in the contract:

- **(a)** it is a pure read RPC returning rows that need a Stripe check; Engineer B's
  server asks Stripe and applies the result via `mark_sponsorship_paid` /
  `mark_payment_failed`; or
- **(b)** it enqueues into a tiny `stripe_reconcile_queue` table that Engineer B drains.

Engineer B's current code assumes **(a)**. Confirm before you build (b).

**Security requirement (non-negotiable):** `place_bid` must authenticate `p_brand_id`
against the caller's session inside the RPC — `p_brand_id` comes from the request and
must be validated against `auth.uid()`, never trusted. Same for every RPC that takes a
profile id. Cron RPCs take only batch sizes and configuration, never user ids or amounts.

---

## 5. New `notifications` table  ⬜

**Why:** the current notification mechanism is shadcn toast + sonner, which is ephemeral.
The brief requires notifications that persist (payout released, refund completed,
review pending, …). Toast remains the *delivery* surface; this table is the *record*.

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  related_type text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, type, related_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read
  ON notifications(recipient_id, read_at, created_at DESC);
```

Allowed `type` values (contract §7):

```text
bid_accepted, outbid, auction_ended, winner_selected, payment_required,
payment_expiring, payment_successful, product_shipped, product_received,
review_pending, review_published, payout_released, refund_completed, fallback_selected
```

**Migration notes**
- If you already have a notification design, **yours wins** — say so and Engineer B will
  drop this request and adapt.
- `UNIQUE (recipient_id, type, related_id)` makes notification creation idempotent so a
  webhook replay does not spam a user. It is why the notification helper can be
  fire-and-forget.
- RLS: read own rows; update `read_at` on own rows only; no client inserts.

---

## 6. Partial unique indexes — double-sell / double-payout guards  ⬜

**Why:** these are what let the application be correct without a global lock. Each one
enforces a "at most one" rule that would otherwise require serialization.

```sql
-- At most one winning/paying bid per slot.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slot_paying_bid
  ON auction_bids(slot_id)
  WHERE status IN ('winning', 'payment_pending');

-- At most one open (unpaid-or-paid, not refunded) sponsorship per slot.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slot_unpaid_sponsorship
  ON sponsorships(slot_id)
  WHERE status IN ('pending', 'paid')
    AND refund_status IN ('none', 'pending');

-- At most one successful transfer per sponsorship. This is the double-payout guard.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sponsorship_released_transfer
  ON sponsorships(id)
  WHERE payout_status = 'released';

-- At most one open refund per sponsorship.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sponsorship_open_refund
  ON sponsorships(id)
  WHERE refund_status IN ('pending');
```

**Migration notes**
- These are safe to add to an empty/legacy database; the existing sponsorship rows are
  all `pending` and there is at most one per slot today, so no data fix is needed. Please
  verify before applying.
- If any of these conflict with constraints you prefer to enforce in the RPC, say which
  ones — Engineer B will add an equivalent application-level guard and document the
  residual race window.
- `uniq_slot_unpaid_sponsorship` deliberately includes `paid`: a paid sponsorship still
  owns the slot until it is refunded. A refunded slot may be re-auctioned.

---

## Non-goals (Engineer B will not request)

- No changes to `profiles`, `days`, `reviews`, or `deliverables` beyond the foreign keys
  listed above.
- No changes to existing RLS policies on those tables.
- No new enums — all status columns stay `text` + `CHECK` to match the existing style.
- No generated-types pipeline work; that is Engineer A's. Engineer B uses a temporary
  typed layer (`lib/auction-types.ts`) until the generated types are merged, then deletes
  it.

---

## How Engineer B will consume the result

1. Engineer A merges the migration + generated types.
2. Engineer B deletes `lib/auction-types.ts` and switches `lib/auction-queries.ts` to the
   generated `Database` type.
3. Engineer B removes the temporary RPC stubs (see `lib/auction-rpc-stubs.ts`) and points
   the callers at the real RPCs.
4. Engineer B runs the integration test suite against a local Supabase with the migration
   applied, and reports the result in the handoff.

Until that merge happens, Engineer B's code is **unit-tested against the contract** and
must not be described as integration-tested. The handoff report will say so explicitly.
