# DaySponsor — Database & Auction Engine Implementation

Owner: Engineer A (database, atomic auction engine, RLS, DB tests).
Not owned here: Stripe server modules, Stripe webhook routes, all UI components, `package.json`.

---

## 1. Repository state before this work

| Property | Value |
|---|---|
| Git tracked | **No** — `/home/prateek/Downloads/DaySponsor-main` is not a git repository |
| Supabase CLI available | **No** |
| Generated DB types tracked | **No** — no `types/database.d.ts`, no `supabase/config.toml` |
| DB types source | Hand-written in `lib/supabase.ts` (the de-facto contract for the frontend) |
| Local Postgres | **No** (`psql`, `initdb` absent); Docker daemon is available |
| `package.json` scripts | `dev`, `build`, `start`, `lint` (`next lint`), `typecheck` (`tsc --noEmit`) |
| CI (`.github/workflows/ci.yml`) | `npm ci` → `npm run typecheck` → `npm run build` |
| Test runner | **None declared** — no `test` script, no test dependency |

Migrations in flight before this work:

```
supabase/migrations/20260903215330_create_daysponsor_schema.sql
supabase/migrations/20260903220845_add_video_fields_to_reviews.sql
```

---

## 2. Existing tables — exact names and columns

### `profiles`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | `DEFAULT gen_random_uuid()` |
| `user_id` | uuid NOT NULL | `DEFAULT auth.uid()`, FK `auth.users(id) ON DELETE CASCADE` |
| `email` | text NOT NULL | |
| `name` | text NOT NULL | |
| `username` | text UNIQUE | |
| `avatar_url` | text | |
| `role` | text NOT NULL | `CHECK (role IN ('creator','brand','admin'))`, default `'creator'` |
| `bio` | text | |
| `created_at` | timestamptz | `DEFAULT now()` |
| `updated_at` | timestamptz | `DEFAULT now()` |

**There is no `brand_profiles` table.** A "brand profile" is a `profiles` row with `role = 'brand'`.
This is why `bids.brand_id` and `sponsorships.brand_id` reference `profiles(id)`.
Creating a duplicate `brand_profiles` table is explicitly forbidden by the phase brief and unnecessary.

### `creator_profiles`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` | uuid NOT NULL | FK `profiles(id) ON DELETE CASCADE` |
| `occupation` | text | |
| `location` | text | |
| `country_code` | text | default `''` |
| `followers` | text | default `''` |
| `impressions` | text | default `''` |
| `social_links` | jsonb | default `'[]'` |
| `audience_description` | text | |
| `stripe_account_id` | text | **creator Stripe Connected Account** (payout destination) |
| `stripe_onboarding_complete` | boolean | default `false` |
| `total_earned` | **numeric** | default `0` — legacy aggregate; untouched |
| `days_sponsored` | integer | default `0` |
| `creator_rating` | **numeric** | default `0` — legacy aggregate; untouched |
| `created_at` | timestamptz | |

> Note: `total_earned` / `creator_rating` are the only `numeric` columns in the schema. All new
> money columns introduced by this work use `bigint` integer minor units (see §5).

### `days`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `creator_id` | uuid NOT NULL | FK `profiles(id) ON DELETE CASCADE` |
| `title` | text NOT NULL | |
| `description` | text | |
| `day_date` | date NOT NULL | |
| `location` | text | |
| `category` | text NOT NULL | default `'Developer'` |
| `expected_reach` | text | default `'~10,000'` |
| `status` | text NOT NULL | `CHECK (status IN ('draft','live','full','in_progress','completed','cancelled'))`, default `'draft'` |
| `image_url` | text | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `sponsorship_slots`  (auction host table)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `day_id` | uuid NOT NULL | FK `days(id) ON DELETE CASCADE` |
| `tier` | text NOT NULL | `CHECK (tier IN ('Primary','Featured','Supporting'))` |
| `price` | **integer** NOT NULL | **legacy fixed price in MAJOR units** (`€299`). Read by `app/checkout/[slot]/page.tsx` and `app/days/[id]/page.tsx`. Left untouched. |
| `position` | integer NOT NULL | default `1` |
| `description` | text | |
| `is_available` | boolean | default `true`; consumed by the legacy checkout path |
| `created_at` | timestamptz | |

New auction columns are **added** to this table (see §4). No existing column is renamed or retyped.

### `sponsorships`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `slot_id` | uuid NOT NULL | FK `sponsorship_slots(id) ON DELETE CASCADE` |
| `brand_id` | uuid NOT NULL | FK `profiles(id) ON DELETE CASCADE` |
| `creator_id` | uuid NOT NULL | FK `profiles(id) ON DELETE CASCADE` |
| `amount` | integer → **bigint** (widened) | see §5 for units |
| `platform_fee` | integer → **bigint** (widened) | |
| `creator_amount` | integer → **bigint** (widened) | |
| `status` | text NOT NULL | see §6 |
| `stripe_payment_intent_id` | text | retained |
| `stripe_checkout_session_id` | text | retained |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `reviews`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `sponsorship_id` | uuid NOT NULL | FK `sponsorships(id) ON DELETE CASCADE` |
| `rating` | integer NOT NULL | `CHECK (rating >= 1 AND rating <= 5)` — already correct |
| `title` | text | |
| `content` | text | |
| `pros` | text[] | default `'{}'` |
| `cons` | text[] | default `'{}'` |
| `would_recommend` | boolean | default `true` |
| `video_url` | text | added by migration `20260903220845` |
| `video_platform` | text | `CHECK (… IN ('instagram','tiktok','youtube','x','other') OR NULL)` |
| `published_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**`reviews` has no `brand_id` column and this work deliberately adds none.**
Phase 7's "creator cannot submit a brand ID manually" is therefore satisfied structurally; the
review's brand is always derived from `sponsorships.brand_id`, which is in turn pinned to the
winning bid by a database invariant (§7).

### `deliverables`
`id`, `sponsorship_id`, `type`, `url`, `description`, `status`, `completed_at`, `created_at`. Unchanged.

---

## 3. Existing RLS posture (and its gaps)

All seven tables have `ENABLE ROW LEVEL SECURITY`. Policies in force:

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own row or any creator/brand | own row | own row | — |
| `creator_profiles` | all authenticated | own profile | own profile | — |
| `days` | all authenticated | day's creator | day's creator | day's creator |
| `sponsorship_slots` | all authenticated | day's creator | day's creator | day's creator |
| `sponsorships` | brand, creator, or admin | **brand only** | brand, creator, **or admin** | — |
| `reviews` | all authenticated (public) | sponsorship's creator | sponsorship's creator | — |
| `deliverables` | brand or creator | sponsorship's creator | sponsorship's creator | — |

Gaps this work closes (Phase 8):

1. **`sponsorships` UPDATE is granted to the brand, the creator, *and* any admin, with no column
   restriction and no transition check.** Any brand could `UPDATE sponsorships SET status='paid'`,
   or set `amount`/`platform_fee`/`creator_amount` on its own row. Any creator could mark a
   sponsorship `paid`. This is the single largest pre-existing hole.
2. **No column-level guard on financial fields** — `amount`, `platform_fee`, `creator_amount`,
   and the two legacy Stripe ID columns are client-writable through the UPDATE policy.
3. **`reviews` UPDATE lets the creator rewrite a published review indefinitely** with no status
   re-derivation; combined with (1) the brand could not rewrite it (correct), but there was no
   guarantee the reviewed brand was the winning bidder.
4. **`creator_profiles` UPDATE is unrestricted across columns** — a creator could self-award
   `total_earned` / `creator_rating` / `stripe_account_id`. Now restricted (§7).
5. **No policies at all for `bids`, `stripe_webhook_events`, or auction columns** — added from scratch.

---

## 4. Auction fields added to `sponsorship_slots`

Migration `20260916000001_add_auction_fields_to_sponsorship_slots.sql`:

| column | type | notes |
|---|---|---|
| `starting_price` | bigint | minor units; `CHECK (starting_price > 0)` where not null |
| `currency` | text | `CHECK (currency IN ('usd','eur','gbp'))`, default `'usd'` |
| `current_highest_bid` | bigint | minor units; nullable until first bid |
| `current_highest_bid_id` | uuid | FK → `bids(id)` added in migration `…0002` |
| `auction_status` | text | see §6; default `'draft'` |
| `auction_ends_at` | timestamptz | nullable |
| `closed_at` | timestamptz | nullable |
| `winning_bid_id` | uuid | FK → `bids(id)`; `UNIQUE` (one winner per slot) |
| `payment_due_at` | timestamptz | nullable |
| `winner_attempt_count` | integer | `CHECK (winner_attempt_count >= 0)`, default `0` |

`current_highest_bid_id` and `winning_bid_id` are nullable mutually-consistent pointers into
`bids`. The FKs are added in a later migration because `bids.slot_id` must reference
`sponsorship_slots(id)` first (circular dependency resolved by ordering).

## 5. Money units and the cent-rounding rule

**All new money values are integers in minor units (cents). There are no `float`, `double
precision`, or `numeric` columns in the auction path, and no JavaScript floating-point
arithmetic anywhere in the fee computation.**

The platform fee is computed inside the SQL transaction with integer-only arithmetic:

```sql
platform_fee   = floor((amount * 10 + 50) / 100)
creator_amount = amount - platform_fee
```

The `+ 50` term is half of the `* 100` scale, i.e. round-half-up of a 10 % cut to the nearest
whole minor unit. Worked examples (minor units):

| `amount` | `floor((amount*10+50)/100)` | `platform_fee` | `creator_amount` | effective fee |
|---|---|---|---|---|
| 29900 (€299.00) | `floor(299050/100)` | 2990 | 26910 | 10.0000 % |
| 14900 (€149.00) | `floor(149050/100)` | 1490 | 13410 | 10.0000 % |
| 105 (€1.05) | `floor(1100/100)` | 11 | 94 | 10.476 % (ceiling on sub-cent) |
| 100 (€1.00) | `floor(1050/100)` | 10 | 90 | 10 % |

**Units caveat (must be read by Engineer B).** `sponsorship_slots.price` and the legacy
fixed-price checkout in `app/checkout/[slot]/page.tsx` are in **major units** and use
`Math.round(slot.price * 0.1)` in JavaScript. Auction-derived rows are in **minor units** and
compute the fee in SQL. The two paths must not be mixed on one row.
`sponsorships.amount` / `platform_fee` / `creator_amount` were widened `integer → bigint`
(a lossless widening) to carry minor-unit values. A sponsorship created by
`close_expired_auction` always stores minor units. See "Remaining limitations" in the contract.

## 6. Status value definitions

**Slot `auction_status`** (`sponsorship_slots.auction_status`)
`draft` → `open` → `closed` → `awaiting_payment` → `paid` → `completed`, plus `cancelled`.

**`bids.status`**
`active` → `outbid`, or `active` → (selected at close) → `payment_pending` → `paid` → `winner`;
`payment_pending` → `failed` (unpaid default); any → `cancelled`.

| value | meaning |
|---|---|
| `active` | live, eligible bid in an open auction |
| `outbid` | superseded by a higher valid bid |
| `payment_pending` | selected as the winner at close; payment not yet captured |
| `paid` | payment captured for this bid |
| `winner` | terminal success: this bid won **and** its sponsorship reached `completed` |
| `failed` | winner defaulted on payment within the deadline |
| `cancelled` | voided by brand or admin |

**`sponsorships.status`** — the existing enum is preserved and extended:
`pending` (legacy alias of `payment_pending`), `payment_pending`, `paid`, `product_shipped`,
`product_received`, `day_completed`, `review_pending`, `completed`, `cancelled`, `refunded`.

Canonical forward path:
`payment_pending` → `paid` → `product_shipped` → `product_received` → `day_completed` →
`review_pending` → `completed`. Terminal alternatives: `cancelled`, `refunded`.

**`sponsorships.payment_status`** (new): `pending` | `paid` | `failed` | `refunded`.
**`sponsorships.payout_status`** (new): `pending` | `eligible` | `released` | `failed`.

## 7. Invariants enforced by constraint

* `bids.amount > 0` (positive integer minor units).
* `sponsorship_slots.starting_price > 0`.
* `sponsorships.amount > 0`, `platform_fee >= 0`, `creator_amount >= 0`,
  `creator_amount = amount - platform_fee`.
* Exactly one winner per slot: `sponsorship_slots.winning_bid_id` is `UNIQUE` (nullable).
* Exactly one active sponsorship per winning bid: `sponsorships.winning_bid_id` is `UNIQUE`.
* Exactly one successful payout transfer per sponsorship: a partial unique index on
  `sponsorships.stripe_transfer_id` restricted to non-null values.
* Brand consistency: for any sponsorship with `winning_bid_id IS NOT NULL`,
  `sponsorships.brand_id = (SELECT brand_id FROM bids WHERE id = winning_bid_id)` — enforced by
  a `CHECK` constraint, so a review can never be attributed to a losing bidder.
* One review per sponsorship: `reviews.sponsorship_id` is `UNIQUE`.
* `reviews.rating` is an integer in `[1, 5]` (pre-existing). A 1-star review is valid and never
  blocks payout or completion.

## 8. RPC inventory

| RPC | Caller | Purpose |
|---|---|---|
| `place_bid(p_slot_id uuid, p_amount bigint)` | authenticated brand | atomic bid placement |
| `open_auction(p_slot_id uuid, p_starting_price bigint, p_currency text, p_ends_at timestamptz)` | slot's creator | draft → open |
| `close_expired_auction(p_slot_id uuid)` | service role (scheduler) | settle ended auction |
| `expire_unpaid_winner(p_slot_id uuid, p_max_attempts integer)` | service role (scheduler) | unpaid-winner fallback |
| `mark_sponsorship_paid(p_sponsorship_id uuid, p_payment_intent text, p_charge text)` | service role (Stripe webhook) | payment capture |
| `record_refund(p_sponsorship_id uuid, p_refund_id text, p_amount bigint)` | service role (Stripe webhook) | refund |
| `release_payout(p_sponsorship_id uuid, p_transfer_id text)` | service role (Stripe transfer) | payout release |
| `advance_fulfillment(p_sponsorship_id uuid, p_to text)` | authenticated brand or creator | guarded transitions |
| `submit_review(p_sponsorship_id uuid, p_rating integer, p_title text, p_content text, p_pros text[], p_cons text[], p_would_recommend boolean, p_video_url text, p_video_platform text)` | authenticated creator | secure review submission |

Signatures, return shapes and full examples are in `docs/auction-implementation-contract.md`.

## 9. Test infrastructure

No test runner exists and `package.json` is owned by Engineer B, so the database test suite is
self-contained and adds no dependency:

* `tests/db/bootstrap.sql` — builds a minimal `auth.uid()` / `auth.users` shim on a real
  Postgres 15 container, then replays every migration in order.
* `tests/db/run-tests.sh` — starts the container, applies migrations, runs the suites.
* `tests/db/01_place_bid.sql` … `tests/db/06_security.sql` — functional suites.
* `tests/db/concurrency.test.js` — opens 20 parallel TCP connections and fires real concurrent
  bids against `place_bid`, then asserts exactly one leader. Uses `pg` installed with
  `--no-save` into a scratch directory so `package.json` and `package-lock.json` are untouched.

## 10. What this work deliberately does not do

* No Stripe API call is ever made from inside a database transaction (Phase 4 requirement).
* No frontend component is modified beyond the shared type definitions in `lib/supabase.ts`,
  which needed the new columns and status values to keep `tsc --noEmit` honest.
* `package.json`, `package-lock.json`, `.env.example` are untouched.
* `sponsorship_slots.price` (major units) is left in place for the existing UI.
* No `brand_profiles` table is created — `profiles` already serves that role.
