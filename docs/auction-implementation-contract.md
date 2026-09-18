# DaySponsor — Auction & Database Integration Contract

**Audience:** Engineer B (Stripe integration + frontend).
**Owner of this document:** Engineer A (database, auction engine, RLS).
**Companion document:** `docs/database-auction-implementation.md` (findings, rationale, units caveat).

This is the binding contract. Any change to a name, type, status value, or RPC signature below
must be coordinated.

---

## 1. Table and column names (exact)

### `bids` — NEW

| column | type | nullable | default | notes |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `slot_id` | uuid | NO | — | FK `sponsorship_slots(id) ON DELETE CASCADE` |
| `brand_id` | uuid | NO | — | FK `profiles(id)` (profile with `role='brand'`) |
| `amount` | bigint | NO | — | **minor units**, `CHECK (amount > 0)` |
| `currency` | text | NO | `'usd'` | derived from slot at insert; client value ignored |
| `status` | text | NO | `'active'` | see §3 |
| `created_at` | timestamptz | NO | `now()` | tie-breaker #2 |
| `updated_at` | timestamptz | NO | `now()` | |

Indexes: `bids(slot_id, status, amount DESC NULLS LAST, created_at, id)` (deterministic
winner ordering + the "one selected leader" assertions),
`bids(slot_id, status)` (status filter), `bids(brand_id)`.

**Public leader view:** `public.auction_leader(slot_id, amount, currency, created_at, status)`
— the row `sponsorship_slots.current_highest_bid_id` points at, projected **without**
`brand_id` (RLS is row-level, so the row itself can never be exposed to rivals). Owner-run
view, `SELECT` granted to `authenticated`: the live-bid UI's public ask. Not in the
generated types (views aren't emitted) — select it explicitly.

### `sponsorship_slots` — EXTENDED

Existing unchanged: `id`, `day_id`, `tier`, `price` (**major units, legacy**), `position`,
`description`, `is_available`, `created_at`.

| NEW column | type | nullable | default | notes |
|---|---|---|---|---|
| `starting_price` | bigint | YES | — | minor units, `> 0` |
| `currency` | text | NO | `'usd'` | `usd` / `eur` / `gbp` |
| `current_highest_bid` | bigint | YES | — | minor units |
| `current_highest_bid_id` | uuid | YES | — | FK → `bids(id)` |
| `auction_status` | text | NO | `'draft'` | see §3 |
| `auction_ends_at` | timestamptz | YES | — | must be future when `open` |
| `closed_at` | timestamptz | YES | — | set by close |
| `winning_bid_id` | uuid | YES | — | FK → `bids(id)`, **UNIQUE** |
| `payment_due_at` | timestamptz | YES | — | set by close |
| `winner_attempt_count` | integer | NO | `0` | `>= 0` |

### `sponsorships` — EXTENDED

Existing retained and widened: `amount`, `platform_fee`, `creator_amount` **integer → bigint**.
Existing retained as-is: `stripe_checkout_session_id`, `stripe_payment_intent_id`.

| NEW column | type | nullable | default | notes |
|---|---|---|---|---|
| `slot_id` | uuid | NO | — | **already existed** (reaffirmed; FK `sponsorship_slots(id)`) |
| `winning_bid_id` | uuid | YES | — | FK → `bids(id)`, **UNIQUE** |
| `currency` | text | NO | `'usd'` | mirror of slot currency |
| `payment_status` | text | NO | `'pending'` | `pending` / `paid` / `failed` / `refunded` |
| `payment_due_at` | timestamptz | YES | — | mirror of slot deadline |
| `paid_at` | timestamptz | YES | — | webhook writes |
| `refund_amount` | bigint | YES | — | minor units; `>= 0` |
| `refunded_at` | timestamptz | YES | — | webhook writes |
| `payout_status` | text | NO | `'pending'` | `pending` / `eligible` / `released` / `failed` |
| `payout_eligible_at` | timestamptz | YES | — | set when `day_completed` |
| `payout_released_at` | timestamptz | YES | — | service only |
| `stripe_charge_id` | text | YES | — | webhook writes |
| `stripe_refund_id` | text | YES | — | webhook writes |
| `stripe_transfer_id` | text | YES | — | service only; **unique where not null** |

### `stripe_webhook_events` — NEW (idempotency)

| column | type | nullable | default | notes |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `stripe_event_id` | text | NO | — | **UNIQUE** — the idempotency key |
| `event_type` | text | NO | — | e.g. `payment_intent.succeeded` |
| `resource_id` | text | YES | — | PI / charge / refund / transfer id |
| `payload` | jsonb | NO | — | raw event body |
| `processed_at` | timestamptz | YES | — | null until handled |
| `error_message` | text | YES | — | last failure, if any |
| `created_at` | timestamptz | NO | `now()` | |

RLS: **no client policy at all** — only the service role can touch it.

### `reviews` — EXTENDED

| NEW column | type | nullable | default | notes |
|---|---|---|---|---|
| `brand_id` | uuid | YES | — | **derived server-side**; present so the UI can show "review of brand X" without a join, and so a losing bidder can never be the reviewed brand. NULL for legacy rows. FK → `profiles(id)` |
| `is_featured` | boolean | NO | `false` | UI display flag only |

`sponsorship_id` becomes `UNIQUE` (one review per sponsorship).

---

## 2. RPC signatures and return shapes

All RPCs resolve identity internally. All are `SECURITY DEFINER` where they must act across RLS,
each with `SET search_path = public, public` and a grant only on `EXECUTE`.

### `place_bid(p_slot_id uuid, p_amount bigint)` → `jsonb`

Authenticated brand. Never accepts a currency — the slot's currency is authoritative.

```jsonc
{
  "ok": true,
  "error": null,
  "bid_id": "9b1f…",
  "slot_id": "…",
  "amount": 30500,
  "currency": "eur",
  "status": "active",
  "is_leading": true,
  "current_highest_bid": 30500,
  "current_highest_bid_id": "9b1f…",
  "auction_status": "open",
  "auction_ends_at": "2026-09-20T12:00:00+00:00"
}
```

```jsonc
{ "ok": false, "error": "BID_TOO_LOW", "bid_id": null, "amount": 30000,
  "currency": "eur", "current_highest_bid": 30500, "auction_status": "open" }
```

Deterministic error codes: `UNAUTHENTICATED`, `BRAND_PROFILE_REQUIRED`, `SLOT_NOT_FOUND`,
`AUCTION_NOT_OPEN`, `AUCTION_ENDED`, `INVALID_AMOUNT`, `BELOW_STARTING_PRICE`, `BID_TOO_LOW`,
`SELF_BID_FORBIDDEN`, `AUCTION_FULL`.

### `open_auction(p_slot_id uuid, p_starting_price bigint, p_currency text, p_ends_at timestamptz)` → `jsonb`

Slot's creator only. Error codes: `UNAUTHENTICATED`, `NOT_SLOT_OWNER`, `SLOT_NOT_FOUND`,
`INVALID_STARTING_PRICE`, `UNSUPPORTED_CURRENCY`, `INVALID_END_TIME`, `ALREADY_OPEN`.

### `close_expired_auction(p_slot_id uuid)` → `jsonb` — service role only

```jsonc
{
  "ok": true,
  "slot_id": "…",
  "auction_status": "awaiting_payment",
  "closed_at": "2026-09-20T12:00:01+00:00",
  "winning_bid_id": "…",
  "sponsorship_id": "…",
  "sponsorship": { "id": "…", "amount": 30500, "platform_fee": 3050,
                   "creator_amount": 27450, "currency": "eur",
                   "payment_status": "pending", "payment_due_at": "2026-09-23T12:00:01+00:00" },
  "attempts": 1
}
```

No-bid close: `auction_status` becomes `closed`, `winning_bid_id` / `sponsorship_id` are `null`.
Calling again returns the **same** payload with `"attempts": 1` (idempotent — the re-call does
not duplicate the sponsorship or change state).

### `expire_unpaid_winner(p_slot_id uuid, p_max_attempts integer)` → `jsonb` — service role only

```jsonc
{ "ok": true, "slot_id": "…", "auction_status": "awaiting_payment", "attempts": 2,
  "previous_winner_bid_id": "…", "previous_status": "failed",
  "next_bid_id": "…", "next_amount": 28900, "sponsorship_id": "…",
  "payment_due_at": "2026-09-26T12:00:01+00:00", "cancelled": false }
```

Terminal: `"auction_status": "cancelled"`, `"cancelled": true`, `"next_bid_id": null`,
`"sponsorship_id": null` when `attempts >= p_max_attempts` and no eligible bidder remains.

### `mark_sponsorship_paid(p_sponsorship_id uuid, p_payment_intent_id text, p_charge_id text)` → `jsonb`
Service role (Stripe webhook). Idempotent. Sets `payment_status='paid'`, `status='paid'`,
`paid_at`, the Stripe ids; advances the **slot** to `paid`; marks the winning bid `paid`.
Refuses if already refunded or cancelled.

### `record_refund(p_sponsorship_id uuid, p_refund_id text, p_amount bigint)` → `jsonb`
Service role. Sets `payment_status='refunded'`, `status='refunded'`, `refund_amount`,
`refunded_at`, `stripe_refund_id`; slot → `cancelled`; winning bid → `cancelled`.

### `release_payout(p_sponsorship_id uuid, p_transfer_id text)` → `jsonb`
Service role. Requires `payout_status = 'eligible'`. Sets `payout_status='released'`,
`payout_released_at`, `stripe_transfer_id` (unique).

### `advance_fulfillment(p_sponsorship_id uuid, p_to_status text)` → `jsonb`
Authenticated brand **or** creator, identity from `auth.uid()`. Allowed transitions, with *who*
may drive each:

| from | to | driver |
|---|---|---|
| `paid` | `product_shipped` | brand |
| `product_shipped` | `product_received` | creator |
| `product_received` | `day_completed` | creator |
| `day_completed` | `review_pending` | creator |
| `review_pending` | `completed` | `submit_review` RPC (not this one) |

Error codes: `UNAUTHENTICATED`, `SPONSORSHIP_NOT_FOUND`, `NOT_A_PARTY`,
`INVALID_TRANSITION`, `NOT_ELIGIBLE_FOR_REVIEW`.

### `submit_review(p_sponsorship_id uuid, p_rating integer, p_title text, p_content text,
p_pros text[], p_cons text[], p_would_recommend boolean, p_video_url text,
p_video_platform text)` → `jsonb`

Authenticated creator only. Derives brand from the winning bid — **never** accepts a brand id.
Requires `status >= 'review_pending'` (equivalently `day_completed` reached) and
`payment_status = 'paid'`. `rating` must be an integer 1–5; 1-star is valid and does not affect
payout. Inserts, or updates an existing review, then sets `sponsorships.status = 'completed'`.
Returns `{ ok, review_id, sponsorship_id, status }`.

---

## 3. Status value sets

```
auction_status:  draft open closed awaiting_payment paid completed cancelled

bid status:      active outbid winner payment_pending paid cancelled failed

sponsorship status:  payment_pending paid product_shipped product_received
                     day_completed review_pending completed cancelled refunded
                     (+ legacy 'pending', an alias of payment_pending)

payment_status:  pending paid failed refunded
payout_status:   pending eligible released failed
```

---

## 4. Financial rounding rule

```text
platform_fee   = floor((amount * 10 + 50) / 100)
creator_amount = amount - platform_fee
```

All three are `bigint` minor units. Computed **in SQL**, inside the close transaction, never in
JavaScript. `amount = winning bid amount`, so the sponsorship total equals the winning bid to the
cent.

Examples: 29900 → fee 2990 / creator 26910. 14900 → 1490 / 13410. 105 → 11 / 94.

**Units warning.** `sponsorship_slots.price` and the legacy checkout in
`app/checkout/[slot]/page.tsx` are in **major units** and compute the fee with
`Math.round(price * 0.1)` in JS. Auction-created sponsorships are **minor units** with the SQL
formula. Do not read `price` as minor units, and do not mix the two on one sponsorship row.

---

## 5. Field ownership

### Service role / Stripe webhooks ONLY (RLS denies every client write)

`sponsorships.paid_at`, `refund_amount`, `refunded_at`, `payout_status`,
`payout_eligible_at`, `payout_released_at`, `stripe_charge_id`, `stripe_refund_id`,
`stripe_transfer_id`, `stripe_payment_intent_id`, `stripe_checkout_session_id`;
`sponsorship_slots.closed_at`, `winning_bid_id`, `payment_due_at`, `auction_status` (except the
creator's own `open_auction` call), `current_highest_bid`, `current_highest_bid_id`,
`winner_attempt_count`;
all of `stripe_webhook_events`.

### Derived — must never be written by any client, including the service role writing it directly

`sponsorships.brand_id` (pinned to the winning bid by a `CHECK` constraint),
`sponsorships.amount` / `platform_fee` / `creator_amount` (computed by close/fallback RPCs),
`reviews.brand_id` (derived from the winning bid).

### Client-writable (through RPCs, not direct table writes)

`place_bid` writes `bids.amount`; `submit_review` writes the review content fields;
`advance_fulfillment` advances `sponsorships.status` along the allowed edges only.

### UI may read

All of `bids` (its own brand's rows plus `amount`/`currency`/`created_at`/`status` of the
leader — see RLS note below), `sponsorship_slots` including auction columns, `sponsorships`
(own brand or own creator rows), `reviews` (public), `stripe_webhook_events` never.

**RLS note for the live-bid UI:** a rival brand can read `current_highest_bid` and the
leader's `amount` through the `public.auction_leader` view
(`slot_id`, `amount`, `currency`, `created_at`, `status` — **no `brand_id` column**), but
**not** the leader's `brand_id` on the base `bids` table: RLS is row-level, so admitting
the leader's row would leak its identity. RLS on `bids` admits only a caller's own rows
(or every row to the slot's creator). `place_bid`'s return payload exposes no other
brand's private data.

---

## 6. Fields Stripe webhooks may update

Via the service-role RPCs only, never direct table writes:

| Event → RPC | Columns written |
|---|---|
| `payment_intent.succeeded` / `charge.succeeded` → `mark_sponsorship_paid` | `sponsorships.payment_status`, `status`, `paid_at`, `stripe_payment_intent_id`, `stripe_charge_id`; `bids.status='paid'`; `sponsorship_slots.auction_status='paid'` |
| `charge.refunded` / `refund.*` → `record_refund` | `sponsorships.payment_status`, `status`, `refund_amount`, `refunded_at`, `stripe_refund_id`; `bids.status='cancelled'`; slot `auction_status='cancelled'` |
| `transfer.created` / `transfer.paid` → `release_payout` | `sponsorships.payout_status`, `payout_released_at`, `stripe_transfer_id` |
| *(all events)* → `stripe_webhook_events` | append row if `stripe_event_id` unseen, then set `processed_at` / `error_message` |

**Idempotency contract for Engineer B:** insert the `stripe_event_id` row first; if that insert
fails on the unique constraint, the event was already handled — return 200 and do not replay the
side effects. The RPCs are independently idempotent as a second layer.

---

## 7. Clients must not be able to do these — all are enforced

Mark self winner · change winning bid · close an auction · change current highest bid · mark
payment successful · change amount · change fee · change creator amount · set Stripe IDs ·
trigger payout · mark payout successful · reassign review sponsorship or brand · insert / update
/ delete `bids` rows directly · review a losing brand · submit a review before the sponsorship
is paid and fulfilled.

Direct DML on `bids` is denied to every client role: `place_bid` is the only write path, and it
is a `SECURITY DEFINER` function that takes no trust from RLS.

---

## 8. TypeScript types

Generated/updated definitions live in **`lib/supabase.ts`** (hand-maintyped; no Supabase CLI, no
`types/database.d.ts` exists in this repo). Engineer B imports
`Bid`, `AuctionSlot`, `AuctionSponsorship`, `StripeWebhookEvent`, `ReviewRow` and the
`place_bid` result type from there. RPC calls use `supabase.rpc('place_bid', {…})`.

---

## 9. Remaining database limitations (read before integrating)

1. **Major-vs-minor unit split.** `sponsorship_slots.price` is major units (legacy UI); auction
   fields and auction-created sponsorships are minor units. The migration does **not** backfill
   `starting_price` from `price`, because doing so would silently create €2.99 starting prices.
   Engineer B must populate `starting_price` (or call `open_auction`) explicitly per slot.
2. **No scheduler runs inside Postgres.** `close_expired_auction` and `expire_unpaid_winner` are
   idempotent operations for an external job (cron / Supabase scheduled function / Edge function)
   to invoke with the service role. Nothing in the DB calls them on a timer.
3. **No Stripe call is ever made from a DB transaction.** `mark_sponsorship_paid` etc. only write
   state; the webhook handler owns all HTTP.
4. **No `brand_profiles` table.** Brands are `profiles` rows with `role='brand'`; `bids.brand_id`
   and `sponsorships.brand_id` reference `profiles(id)`.
5. **Currency whitelist** is `usd`, `eur`, `gbp`. Add a migration to extend it — do not relax the
   `CHECK` ad hoc.
6. **`winner_attempt_count` has no built-in cap.** Pass `p_max_attempts` (default 3) from the
   scheduler; the RPC stops and cancels the auction when it is reached.
7. **Existing rows.** Pre-auction sponsorships keep `status='pending'` and null auction fields;
   they remain readable by the current dashboards. `reviews.brand_id` is null for legacy rows.
8. **`payout_eligible_at` is set on `day_completed`** by `advance_fulfillment`, but nothing in the
   DB transfers money — `release_payout` must be driven by the Stripe transfer flow, which is
   Engineer B's.
