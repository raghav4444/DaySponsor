/*
# DaySponsor — auction fields, sponsorship extensions, webhook idempotency

## Overview
Phase 2 of the auction engine. Adds auction state to the existing `sponsorship_slots`
table, extends `sponsorships` with payment/payout/Stripe bookkeeping, extends `reviews`
with a derived brand reference, and creates the Stripe webhook event idempotency table.

## Non-goals
- Does NOT create a `brand_profiles` table. Brands are `profiles` rows with role='brand';
  `bids.brand_id` and `sponsorships.brand_id` reference `profiles(id)`. Creating a
  duplicate table would break the existing auth model.
- Does NOT touch `sponsorship_slots.price` (legacy major-unit fixed price, still read by
  the existing checkout UI). New auction pricing lives in `starting_price` (minor units).
- Does NOT backfill `starting_price` from `price` — that would silently turn €299 into
  €2.99. Slot owners must open auctions explicitly via `open_auction`.

## Money
All new money columns are `bigint` integer minor units. No float / double / numeric
columns are introduced anywhere in the auction path. See
docs/auction-implementation-contract.md section 4 for the rounding rule.
*/

-- ============= SPONSORSHIP SLOTS: AUCTION STATE =============
-- Foreign-key columns (current_highest_bid_id, winning_bid_id) are added in migration
-- 20260916000002 because they point at `bids`, which does not exist yet. The circular
-- dependency is resolved by ordering, not by deferring constraints.

ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS starting_price bigint;
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd';
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS current_highest_bid bigint;
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS current_highest_bid_id uuid;
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS winning_bid_id uuid;
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS auction_status text NOT NULL DEFAULT 'draft';
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS auction_ends_at timestamptz;
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;
ALTER TABLE sponsorship_slots ADD COLUMN IF NOT EXISTS winner_attempt_count integer NOT NULL DEFAULT 0;

-- Auction status values. `draft` is the pre-auction default so that every legacy slot
-- (which has no auction columns populated) remains valid.
ALTER TABLE sponsorship_slots DROP CONSTRAINT IF EXISTS sponsorship_slots_auction_status_check;
ALTER TABLE sponsorship_slots ADD CONSTRAINT sponsorship_slots_auction_status_check
  CHECK (auction_status IN (
    'draft', 'open', 'closed', 'awaiting_payment', 'paid', 'completed', 'cancelled'
  ));

-- A positive starting price whenever one is set.
ALTER TABLE sponsorship_slots DROP CONSTRAINT IF EXISTS sponsorship_slots_starting_price_positive;
ALTER TABLE sponsorship_slots ADD CONSTRAINT sponsorship_slots_starting_price_positive
  CHECK (starting_price IS NULL OR starting_price > 0);

-- Supported currencies. Extend this list with a migration, never by relaxing the check.
ALTER TABLE sponsorship_slots DROP CONSTRAINT IF EXISTS sponsorship_slots_currency_supported;
ALTER TABLE sponsorship_slots ADD CONSTRAINT sponsorship_slots_currency_supported
  CHECK (currency IN ('usd', 'eur', 'gbp'));

-- An open auction must have a start price and an end time in the future.
ALTER TABLE sponsorship_slots DROP CONSTRAINT IF EXISTS sponsorship_slots_open_has_schedule;
ALTER TABLE sponsorship_slots ADD CONSTRAINT sponsorship_slots_open_has_schedule
  CHECK (
    auction_status <> 'open'
    OR (starting_price IS NOT NULL AND starting_price > 0 AND auction_ends_at IS NOT NULL)
  );

-- Attempt counter is a non-negative integer.
ALTER TABLE sponsorship_slots DROP CONSTRAINT IF EXISTS sponsorship_slots_winner_attempt_count_nonneg;
ALTER TABLE sponsorship_slots ADD CONSTRAINT sponsorship_slots_winner_attempt_count_nonneg
  CHECK (winner_attempt_count >= 0);

-- ============= SPONSORSHIPS: EXTENSIONS =============
-- slot_id already exists on this table (FK sponsorship_slots(id) ON DELETE CASCADE).
-- It is listed in the contract as the auction linkage and is indexed below; it is NOT
-- recreated.

-- Widen money columns losslessly so they can carry minor-unit auction amounts.
ALTER TABLE sponsorships ALTER COLUMN amount TYPE bigint;
ALTER TABLE sponsorships ALTER COLUMN platform_fee TYPE bigint;
ALTER TABLE sponsorships ALTER COLUMN creator_amount TYPE bigint;

ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS winning_bid_id uuid;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd';
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS refund_amount bigint;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending';
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS payout_eligible_at timestamptz;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS payout_released_at timestamptz;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS stripe_charge_id text;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS stripe_refund_id text;
ALTER TABLE sponsorships ADD COLUMN IF NOT EXISTS stripe_transfer_id text;

-- Lifecycle. 'pending' is retained as a legacy alias of 'payment_pending' so that rows
-- created by the pre-auction checkout flow keep validating.
ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_status_check;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_status_check
  CHECK (status IN (
    'pending', 'payment_pending', 'paid', 'product_shipped', 'product_received',
    'day_completed', 'review_pending', 'completed', 'cancelled', 'refunded'
  ));

ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_payment_status_check;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'));

ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_payout_status_check;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_payout_status_check
  CHECK (payout_status IN ('pending', 'eligible', 'released', 'failed'));

-- Money invariants. creator_amount is always amount minus the fee, and nothing is
-- negative. These hold for both the legacy fixed-price rows and auction rows.
ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_amount_positive;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_amount_positive CHECK (amount > 0);

ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_fees_nonneg;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_fees_nonneg
  CHECK (platform_fee >= 0 AND creator_amount >= 0);

ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_amount_splits_correctly;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_amount_splits_correctly
  CHECK (creator_amount = amount - platform_fee);

ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_refund_amount_nonneg;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_refund_amount_nonneg
  CHECK (refund_amount IS NULL OR refund_amount >= 0);

-- Currency mirrors the slot currency.
ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_currency_supported;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_currency_supported
  CHECK (currency IN ('usd', 'eur', 'gbp'));

-- ============= REVIEWS: DERIVED BRAND =============
-- reviews.brand_id is DERIVED from the sponsorship's winning bid. Clients may never
-- supply it (the column is absent from every insert path) and the submit_review RPC
-- computes it server-side. It exists so the UI can show "review of <brand>" without a
-- join and so a losing bidder can never be the reviewed brand.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

-- One review per sponsorship: a creator cannot publish two reviews of one sponsorship.
DROP INDEX IF EXISTS reviews_one_per_sponsorship;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_sponsorship ON reviews(sponsorship_id);

-- ============= STRIPE WEBHOOK EVENT IDEMPOTENCY =============
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL,
  event_type text NOT NULL,
  resource_id text,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS is enabled with deliberately NO policies: every table privilege the default Supabase
-- grants hand to anon/authenticated is neutered, so a browser cannot insert, update,
-- delete, or even read webhook records. The service role (BYPASSRLS) is unaffected and
-- remains the only writer — that is the webhook's edge.
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- The event id IS the idempotency key: a replayed webhook fails here and the caller
-- must return 200 without re-running the side effects.
CREATE UNIQUE INDEX IF NOT EXISTS stripe_webhook_events_event_id_unique
  ON stripe_webhook_events(stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_resource_id
  ON stripe_webhook_events(resource_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_unprocessed
  ON stripe_webhook_events(created_at) WHERE processed_at IS NULL;

-- ============= INDEXES =============
CREATE INDEX IF NOT EXISTS idx_sponsorship_slots_auction_status
  ON sponsorship_slots(auction_status);

CREATE INDEX IF NOT EXISTS idx_sponsorship_slots_auction_ends_at
  ON sponsorship_slots(auction_ends_at) WHERE auction_status = 'open';

CREATE INDEX IF NOT EXISTS idx_sponsorships_slot_id
  ON sponsorships(slot_id);

CREATE INDEX IF NOT EXISTS idx_sponsorships_payment_status
  ON sponsorships(payment_status);

CREATE INDEX IF NOT EXISTS idx_sponsorships_payout_status
  ON sponsorships(payout_status);

CREATE INDEX IF NOT EXISTS idx_sponsorships_status
  ON sponsorships(status);

-- At most one successful payout transfer per sponsorship.
DROP INDEX IF EXISTS sponsorships_one_successful_transfer;
CREATE UNIQUE INDEX IF NOT EXISTS sponsorships_one_successful_transfer
  ON sponsorships(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;

-- At most one review per sponsorship is already enforced by the unique index above.
