/*
# DaySponsor — RLS audit and tightening (Phase 8)

## What was wrong
The pre-existing `sponsorships` UPDATE policy granted writes to the brand, the creator
AND any admin, with no column restriction and no transition check. That let:
  - a brand run `UPDATE sponsorships SET status='paid'` on its own row,
  - a brand rewrite `amount` / `platform_fee` / `creator_amount` on its own row,
  - a creator mark an unpaid sponsorship `paid`,
  - any admin set Stripe ids and `payout_status`.
`creator_profiles` was similarly unrestricted and let a creator self-award
`total_earned`, `creator_rating` or `stripe_account_id`.

## How this migration enforces it
Postgres RLS has two hard limits that the design had to respect:

1. **A policy cannot reference `OLD` or `NEW`.** Those record variables only exist inside
   a trigger function. So RLS here answers only "who may touch this row", and a set of
   `BEFORE UPDATE` triggers answer "which columns may change".
2. **There is no `jsonb - jsonb` operator** in Postgres 13+. The changed-column test is
   written with the operators that do exist: `jsonb - text[]` (strip the allowed keys)
   and `jsonb = jsonb` (compare what is left). "Only allowed columns changed" is
   expressed as: the two row images, with the allowed columns deleted from both, are
   still equal.

The triggers are ON by default — they protect every write. The trusted service-role RPCs
in migrations 0005 and 0006 legitimately write the financial and Stripe columns, so they
call `app.set_guard(false)` to lift the column guard for the duration of that one call and
restore it before returning. A client session cannot do this: `app.set_guard` is
`SECURITY DEFINER` owned by postgres, and its EXECUTE is revoked from PUBLIC, anon and
authenticated, so only the table owner / service role may flip the switch. The switch
never relaxes RLS — it only relaxes the column mask, and RLS still gates the rows.

Never set `FORCE ROW LEVEL SECURITY` on these tables. The RPCs are SECURITY DEFINER and
run as the table owner; FORCE would deny them the writes they exist to make.
*/

-- ============= THE COLUMN GUARD SWITCH =============
-- ON by default. Trusted RPCs turn it OFF for the duration of one call and restore it
-- before returning. This function is the ONLY way to turn it off: it is SECURITY
-- DEFINER, owned by postgres, and its EXECUTE is revoked from PUBLIC, anon and
-- authenticated. A client session can neither SET the custom GUC directly (it is never
-- granted) nor call this function.
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.guard_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app
AS $$ SELECT current_setting('app.guard_enabled', true) = 'on' $$;

CREATE OR REPLACE FUNCTION app.set_guard(p_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app
AS $$
BEGIN
  IF p_on THEN
    SET LOCAL app.guard_enabled = 'on';
  ELSE
    SET LOCAL app.guard_enabled = 'off';
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.guard_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.set_guard(boolean) FROM PUBLIC, anon, authenticated;

-- ============= SPONSORSHIPS: WHO MAY TOUCH THE ROW (RLS) =============
DROP POLICY IF EXISTS "sponsorships_update_parties" ON sponsorships;

CREATE POLICY "sponsorships_update_parties_guarded"
ON sponsorships FOR UPDATE
TO authenticated
USING (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.brand_id)
  OR
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.creator_id)
  OR
  auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
)
WITH CHECK (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.brand_id)
  OR
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.creator_id)
  OR
  auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
);

-- ============= SPONSORSHIPS: WHICH COLUMNS MAY CHANGE (TRIGGER) =============
-- A client may move `status` only along a legal forward edge, and may not change any
-- financial, payment, payout or Stripe column at all. amount / platform_fee /
-- creator_amount / payout_status / stripe_* are therefore unreachable from a client.
CREATE OR REPLACE FUNCTION public.tg_sponsorships_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, public
AS $$
DECLARE
  v_allowed text[] := ARRAY['status', 'updated_at'];
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;   -- trusted service-role write; only RPCs reaching this point can be here
  END IF;

  v_old := to_jsonb(OLD) - v_allowed;
  v_new := to_jsonb(NEW) - v_allowed;

  IF v_old != v_new THEN
    RAISE EXCEPTION
      'sponsorship %: client may only set status (and updated_at); other columns changed: %',
      NEW.id,
      (SELECT COALESCE(string_agg(k, ', '), '') FROM jsonb_object_keys(v_new - v_old) k)
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.sponsorships_status_transition_ok(OLD.status, NEW.status) THEN
    RAISE EXCEPTION
      'sponsorship %: illegal status transition % -> %',
      NEW.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sponsorships_client_writable ON sponsorships;
CREATE TRIGGER trg_sponsorships_client_writable
  BEFORE UPDATE ON sponsorships
  FOR EACH ROW EXECUTE FUNCTION public.tg_sponsorships_client_writable();

-- Transition table. This is the single source of truth for client-driven moves.
-- Service-role RPCs go around RLS, so webhook-driven writes are not limited by this.
CREATE OR REPLACE FUNCTION public.sponsorships_status_transition_ok(
  p_from text,
  p_to text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, public
AS $$
  SELECT p_to = p_from                                  -- no-op is always fine
  OR (
    -- forward path, in order
    (p_from = 'pending'        AND p_to = 'paid')
 OR (p_from = 'payment_pending' AND p_to = 'paid')
 OR (p_from = 'paid'           AND p_to = 'product_shipped')
 OR (p_from = 'product_shipped' AND p_to = 'product_received')
 OR (p_from = 'product_received' AND p_to = 'day_completed')
 OR (p_from = 'day_completed'  AND p_to = 'review_pending')
 OR (p_from = 'review_pending' AND p_to = 'completed')
 OR (p_from = 'review_pending' AND p_to = 'cancelled')
 OR (p_from = 'paid'           AND p_to = 'cancelled')
 OR (p_from = 'payment_pending' AND p_to = 'cancelled')
 OR (p_from = 'pending'        AND p_to = 'cancelled')
 OR (p_from = 'paid'           AND p_to = 'refunded')
 OR (p_from = 'payment_pending' AND p_to = 'refunded')
 OR (p_from = 'product_shipped' AND p_to = 'refunded')
 OR (p_from = 'product_received' AND p_to = 'refunded')
 OR (p_from = 'day_completed'  AND p_to = 'refunded')
  )
$$;

-- ============= SPONSORSHIPS: INSERT =============
-- A brand may still create its own sponsorship row (legacy checkout path) but only with
-- the legacy fixed-price shape and never with financial/payout/Stripe columns set.
DROP POLICY IF EXISTS "sponsorships_insert_own" ON sponsorships;
CREATE POLICY "sponsorships_insert_own"
ON sponsorships FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.brand_id)
  AND sponsorships.winning_bid_id IS NULL
  AND sponsorships.payout_status = 'pending'
  AND sponsorships.paid_at IS NULL
  AND sponsorships.refund_amount IS NULL
  AND sponsorships.refunded_at IS NULL
  AND sponsorships.payout_eligible_at IS NULL
  AND sponsorships.payout_released_at IS NULL
  AND sponsorships.stripe_charge_id IS NULL
  AND sponsorships.stripe_refund_id IS NULL
  AND sponsorships.stripe_transfer_id IS NULL
);

-- ============= BIDS: SELECT =============
-- Auction transparency WITHOUT identity leakage. RLS admits only the rows a caller owns:
-- their own bids, or every bid if they are the slot's creator. The leading amount — the
-- auction's public ask — is readable by anyone through sponsorship_slots
-- (current_highest_bid is public) and the security-invoker view public.auction_leader
-- below, which projects amount/currency/created_at and deliberately OMITS brand_id.
--
-- Why no third "leader" row arm: RLS is row-level, not column-level. Admitting the
-- leader's ROW to a rival brand would hand them the leader's brand_id — exactly the
-- identity the contract promises to hide. Column privacy therefore comes from the view,
-- which is the only public edge that touches another brand's bid data.
DROP POLICY IF EXISTS "bids_select_public_leader" ON bids;
DROP POLICY IF EXISTS "bids_select_owner_or_creator" ON bids;
CREATE POLICY "bids_select_owner_or_creator"
ON bids FOR SELECT
TO authenticated
USING (
  -- my own bid
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = bids.brand_id)
  OR
  -- the slot's creator sees every bid on their own day
  EXISTS (
    SELECT 1
    FROM sponsorship_slots sl
    JOIN days d ON d.id = sl.day_id
    JOIN profiles p ON p.id = d.creator_id
    WHERE sl.id = bids.slot_id AND p.user_id = auth.uid()
  )
);

-- Public leader projection: the leading amount/currency/created_at of a slot, WITHOUT
-- brand_id or bid id. The view runs as its OWNER (security_invoker = false, the default)
-- so the base-table RLS — which correctly withholds other brands' bid ROWS — does not
-- hide the public ask; column privacy is enforced structurally, by the projection
-- itself: brand_id is simply not a column of this view. A rival brand learns the ask
-- but never the leader's identity. Creators keep full row access through the base table.
CREATE OR REPLACE VIEW public.auction_leader AS
SELECT b.slot_id, b.amount, b.currency, b.created_at, b.status
FROM public.bids b
JOIN public.sponsorship_slots sl ON sl.id = b.slot_id
WHERE sl.current_highest_bid_id = b.id
  AND b.status IN ('active', 'payment_pending', 'paid');

REVOKE ALL ON public.auction_leader FROM PUBLIC, anon;
GRANT SELECT ON public.auction_leader TO authenticated;

-- No INSERT / UPDATE / DELETE policy exists for bids on purpose. RLS denies by default,
-- so a normal authenticated client has no direct DML on bids at all. The only write path
-- is the `place_bid` SECURITY DEFINER RPC.

-- ============= SPONSORSHIP SLOTS: WHO MAY TOUCH (RLS) =============
-- The owning creator may still adjust presentation, but auction settlement columns are
-- closed to them: closed_at, winning_bid_id, current_highest_bid(_id), payment_due_at,
-- winner_attempt_count and auction_status are all absent from the trigger's allowed set.
DROP POLICY IF EXISTS "slots_update_own" ON sponsorship_slots;
CREATE POLICY "slots_update_own_guarded"
ON sponsorship_slots FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM days d
    JOIN profiles p ON p.id = d.creator_id
    WHERE d.id = sponsorship_slots.day_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM days d
    JOIN profiles p ON p.id = d.creator_id
    WHERE d.id = sponsorship_slots.day_id AND p.user_id = auth.uid()
  )
);

-- ============= SPONSORSHIP SLOTS: WHICH COLUMNS MAY CHANGE (TRIGGER) =============
CREATE OR REPLACE FUNCTION public.tg_slots_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'id', 'day_id', 'created_at', 'updated_at',
    'tier', 'price', 'position', 'description', 'is_available',
    'starting_price', 'currency', 'auction_ends_at'
  ];
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD) - v_allowed;
  v_new := to_jsonb(NEW) - v_allowed;

  IF v_old != v_new THEN
    RAISE EXCEPTION
      'slot %: client may not change auction settlement columns: %',
      NEW.id,
      (SELECT COALESCE(string_agg(k, ', '), '') FROM jsonb_object_keys(v_new - v_old) k)
      USING ERRCODE = 'check_violation';
  END IF;

  -- a client may not flip the auction status at all; open_auction / close_expired_auction
  -- / expire_unpaid_winner are the only paths that may, and they run as service role
  IF NEW.auction_status IS DISTINCT FROM OLD.auction_status THEN
    RAISE EXCEPTION 'slot %: auction_status may not be set by a client', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slots_client_writable ON sponsorship_slots;
CREATE TRIGGER trg_slots_client_writable
  BEFORE UPDATE ON sponsorship_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_slots_client_writable();

-- ============= CREATOR PROFILES: WHO MAY TOUCH (RLS) =============
DROP POLICY IF EXISTS "creator_profiles_update_own" ON creator_profiles;
CREATE POLICY "creator_profiles_update_own_guarded"
ON creator_profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = creator_profiles.profile_id AND profiles.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = creator_profiles.profile_id AND profiles.user_id = auth.uid())
);

-- ============= CREATOR PROFILES: WHICH COLUMNS MAY CHANGE (TRIGGER) =============
-- A creator may update only the safe presentation columns. total_earned, creator_rating,
-- stripe_account_id and stripe_onboarding_complete are closed to them — those are
-- written by trusted server code only, in a guarded write.
CREATE OR REPLACE FUNCTION public.tg_creator_profiles_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'profile_id', 'updated_at',
    'occupation', 'location', 'country_code', 'followers', 'impressions',
    'social_links', 'audience_description'
  ];
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD) - v_allowed;
  v_new := to_jsonb(NEW) - v_allowed;

  IF v_old != v_new THEN
    RAISE EXCEPTION
      'creator profile %: client may only set presentation columns: %',
      NEW.profile_id,
      (SELECT COALESCE(string_agg(k, ', '), '') FROM jsonb_object_keys(v_new - v_old) k)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creator_profiles_client_writable ON creator_profiles;
CREATE TRIGGER trg_creator_profiles_client_writable
  BEFORE UPDATE ON creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_creator_profiles_client_writable();

-- ============= STRIPE WEBHOOK EVENTS: NO CLIENT ACCESS =============
-- No policy at all for any role: RLS denies by default, so only the service role (which
-- bypasses RLS) can read or write the idempotency ledger.
DROP POLICY IF EXISTS "stripe_webhook_events_deny_all" ON stripe_webhook_events;
-- (intentionally no policy created)

-- ============= REVIEWS: TIGHTEN =============
-- The creator of the sponsoring day may still create/edit a review (existing behavior),
-- but only one review per sponsorship (unique index) and the brand is always derived.
-- The insert path no longer needs a brand_id: submit_review sets it.
DROP POLICY IF EXISTS "reviews_insert_creator" ON reviews;
CREATE POLICY "reviews_insert_creator"
ON reviews FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = reviews.sponsorship_id AND p.user_id = auth.uid()
  )
  -- a client may not forge the brand; the RPC derives it from the winning bid
  AND reviews.brand_id IS NULL
);

DROP POLICY IF EXISTS "reviews_update_creator" ON reviews;
DROP POLICY IF EXISTS "reviews_update_creator_guarded" ON reviews;
-- NOTE ON NEW/OLD IN POLICIES: this Postgres build rejects any NEW./OLD. reference in an
-- RLS policy expression with "missing FROM-clause entry for table new" -- as the whole
-- expression, with RLS disabled, and with check_function_bodies = off alike. Because an
-- anti-reassignment guard must compare the new row against the old one, it cannot be
-- expressed in a policy here at all. It is enforced by the trigger below, which can see
-- both OLD and NEW. RLS still owns ownership (USING); the trigger owns immutability.
CREATE POLICY "reviews_update_creator_guarded"
ON reviews FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = reviews.sponsorship_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = reviews.sponsorship_id AND p.user_id = auth.uid()
  )
);

-- ============= REVIEWS: WHICH COLUMNS MAY CHANGE (TRIGGER) =============
-- A client may not reassign a review to a different sponsorship, or re-point its brand.
-- brand_id is derived from the winning bid by submit_review; sponsorship_id is fixed at
-- insert. Neither may move once set.
CREATE OR REPLACE FUNCTION public.tg_reviews_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, public
AS $$
BEGIN
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.sponsorship_id IS DISTINCT FROM OLD.sponsorship_id THEN
    RAISE EXCEPTION 'review %: sponsorship_id may not be changed', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'review %: brand_id may not be changed', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_client_writable ON reviews;
CREATE TRIGGER trg_reviews_client_writable
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_reviews_client_writable();
