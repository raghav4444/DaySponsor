/*
# DaySponsor — bids table and cross-table invariants

## Overview
Creates `bids` and back-references it from `sponsorship_slots` and `sponsorships`.
The slot back-reference columns were declared (nullable, no FK) in migration
20260916000001 because `bids` did not yet exist; this migration adds the foreign keys
now that the target table is in place.

## Security
RLS is enabled on `bids` with NO client policies for INSERT/UPDATE/DELETE. The only
write path is the `place_bid` SECURITY DEFINER RPC (migration 20260916000004). A normal
authenticated client therefore cannot insert, update or delete a bid row at all.
*/

-- ============= BIDS =============
CREATE TABLE IF NOT EXISTS bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES sponsorship_slots(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_amount_positive;
ALTER TABLE bids ADD CONSTRAINT bids_amount_positive
  CHECK (amount > 0);

ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_currency_supported;
ALTER TABLE bids ADD CONSTRAINT bids_currency_supported
  CHECK (currency IN ('usd', 'eur', 'gbp'));

ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_status_check;
ALTER TABLE bids ADD CONSTRAINT bids_status_check
  CHECK (status IN ('active', 'outbid', 'winner', 'payment_pending', 'paid', 'cancelled', 'failed'));

-- Postgres forbids subqueries in a CHECK constraint, so "the bidder must hold the
-- brand role" is enforced by the trigger below instead. place_bid resolves the brand
-- identity server-side before inserting, so this is a backstop, not the primary gate.
CREATE OR REPLACE FUNCTION public.tg_bids_brand_is_brand_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.brand_id AND p.role = 'brand') THEN
    RAISE EXCEPTION 'bid brand % is not a brand profile', NEW.brand_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bids_brand_is_brand_role ON bids;
CREATE TRIGGER trg_bids_brand_is_brand_role
  BEFORE INSERT OR UPDATE OF brand_id ON bids
  FOR EACH ROW EXECUTE FUNCTION public.tg_bids_brand_is_brand_role();

-- Deterministic winner ordering: highest amount, then earliest created_at, then id.
-- This index is also the probe the close/fallback RPCs use to find the winner, so it
-- doubles as the hot path for "who is leading this auction".
CREATE INDEX IF NOT EXISTS idx_bids_slot_status_amount_created_id
  ON bids(slot_id, status, amount DESC NULLS LAST, created_at ASC, id);

CREATE INDEX IF NOT EXISTS idx_bids_slot_status
  ON bids(slot_id, status);

CREATE INDEX IF NOT EXISTS idx_bids_brand_id
  ON bids(brand_id);

-- ============= SLOT BACK-REFERENCES =============
-- winning_bid_id is created in migration 20260916000001 (nullable, no FK) because it
-- points at `bids`, which does not exist until this migration. Now that bids exists, the
-- foreign keys can be attached. Ordering resolves the circular dependency, not deferral.
--
-- Exactly one selected winner per slot. UNIQUE + nullable means at most one slot can
-- claim a given bid as its winner.
ALTER TABLE sponsorship_slots DROP CONSTRAINT IF EXISTS sponsorship_slots_winning_bid_id_fkey;
ALTER TABLE sponsorship_slots ADD CONSTRAINT sponsorship_slots_winning_bid_id_fkey
  FOREIGN KEY (winning_bid_id) REFERENCES bids(id) ON DELETE SET NULL;

ALTER TABLE sponsorship_slots DROP CONSTRAINT IF EXISTS sponsorship_slots_current_highest_bid_id_fkey;
ALTER TABLE sponsorship_slots ADD CONSTRAINT sponsorship_slots_current_highest_bid_id_fkey
  FOREIGN KEY (current_highest_bid_id) REFERENCES bids(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS sponsorship_slots_winning_bid_unique;
CREATE UNIQUE INDEX IF NOT EXISTS sponsorship_slots_winning_bid_unique
  ON sponsorship_slots(winning_bid_id) WHERE winning_bid_id IS NOT NULL;

-- ============= SPONSORSHIP BACK-REFERENCES =============
-- At most one sponsorship per winning bid.
ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_winning_bid_id_fkey;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_winning_bid_id_fkey
  FOREIGN KEY (winning_bid_id) REFERENCES bids(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS sponsorships_winning_bid_unique;
CREATE UNIQUE INDEX IF NOT EXISTS sponsorships_winning_bid_unique
  ON sponsorships(winning_bid_id) WHERE winning_bid_id IS NOT NULL;

-- Brand consistency: the sponsorship's brand must be the winning bid's brand. This is
-- the structural guarantee behind Phase 7 ("review brand is derived from winning bid
-- brand" / "losing brands cannot be reviewed for the sponsorship"). CHECK cannot hold a
-- subquery in Postgres, so it is enforced by the trigger below on both sides of the pair.
CREATE OR REPLACE FUNCTION public.tg_sponsorships_winning_bid_brand_matches()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, public
AS $$
DECLARE
  v_bid_brand uuid;
BEGIN
  IF NEW.winning_bid_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT brand_id INTO v_bid_brand FROM bids WHERE id = NEW.winning_bid_id;
  IF v_bid_brand IS NULL THEN
    RAISE EXCEPTION 'winning_bid_id % does not exist', NEW.winning_bid_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.brand_id IS DISTINCT FROM v_bid_brand THEN
    RAISE EXCEPTION 'sponsorship brand % does not match winning bid brand %',
      NEW.brand_id, v_bid_brand USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sponsorships_winning_bid_brand_matches ON sponsorships;
CREATE TRIGGER trg_sponsorships_winning_bid_brand_matches
  BEFORE INSERT OR UPDATE OF winning_bid_id, brand_id ON sponsorships
  FOR EACH ROW EXECUTE FUNCTION public.tg_sponsorships_winning_bid_brand_matches();

-- A slot has at most one live sponsorship while awaiting/collecting payment.
DROP INDEX IF EXISTS sponsorships_one_active_per_slot;
CREATE UNIQUE INDEX IF NOT EXISTS sponsorships_one_active_per_slot
  ON sponsorships(slot_id)
  WHERE status NOT IN ('cancelled', 'refunded');

-- ============= UPDATED_AT TRIGGER =============
-- Keeps bids.updated_at honest; the RPCs also set it explicitly.
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bids_set_updated_at ON bids;
CREATE TRIGGER trg_bids_set_updated_at
  BEFORE UPDATE ON bids
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_sponsorships_set_updated_at ON sponsorships;
CREATE TRIGGER trg_sponsorships_set_updated_at
  BEFORE UPDATE ON sponsorships
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
