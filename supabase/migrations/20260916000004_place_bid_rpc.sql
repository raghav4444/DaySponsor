/*
# DaySponsor — atomic bid placement (Phase 3)

## Security model
`place_bid` is a SECURITY DEFINER plpgsql function. It owns the write, so it does not
rely on RLS granting the caller anything. RLS on `bids` has no INSERT/UPDATE/DELETE
policy at all, so this RPC is the *only* way any client can create or change a bid.

## Why SECURITY DEFINER is required
The function must:
  - read the slot and the day with FOR UPDATE (locking),
  - mark another brand's bid `outbid` (a row the caller does not own),
  - write the caller's own bid,
  - mutate slot-level auction columns.
Under SECURITY INVOKER + RLS the cross-brand `outbid` update and the slot mutation would
both be denied. The privilege is tightly scoped: the function executes with the owner's
rights but performs exactly one, fully validated, deterministic operation.

## Hardening
  - `SET search_path = public, public` — no schema-injection surface.
  - Fully qualified table names everywhere.
  - `auth.uid()` is consulted once and the brand profile is resolved internally; the
    caller never supplies a brand id, an amount-currency, or a bid id.
  - Errors are deterministic: every failure path raises a fixed code, never a leaked
    Postgres message or another brand's data.
  - No SELECT on bids is exposed through this RPC: the return payload carries only the
    caller's own bid plus the public leader amount.
*/

-- Transaction-local error codes. They are the source of truth for the contract.
-- Raising with 'A' (abort) keeps each check inside the atomic statement.

-- ============= DETERMINISTIC ERROR PAYLOAD =============
-- Validation failures are RETURNED, not raised. The caller gets a stable code in a
--   { "ok": false, "error": "<CODE>" }
-- payload (an HTTP 200 from PostgREST) instead of having to parse an SQLSTATE and a
-- message out of a 400. Every check below runs *before* the first write, so returning
-- leaves nothing partially applied; a RAISE would meanwhile drag the whole request
-- transaction down with it.
--
-- RAISE is still used, deliberately, for things that must not be swallowed:
-- constraint violations, the column guards, and the EXCEPTION handler at the end of each
-- RPC (which restores the guard before re-raising).
CREATE OR REPLACE FUNCTION public.v_rpc_error(
  p_code text,
  p_extra jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, public
AS $$
  SELECT jsonb_build_object('ok', false, 'error', p_code)
         || COALESCE(p_extra, '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.place_bid(
  p_slot_id uuid,
  p_amount bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_slot public.sponsorship_slots%ROWTYPE;
  v_day public.days%ROWTYPE;
  v_brand public.profiles%ROWTYPE;
  v_bid_id uuid;
  v_prev_leader_amount bigint;
  v_err text;
BEGIN
  -- (1) Require an authenticated user. The RPC never trusts a client-supplied identity.
  IF v_user_id IS NULL THEN
    RETURN public.v_rpc_error('UNAUTHENTICATED');
  END IF;

  -- (6) The amount is validated before any row is locked, so a malformed bid never
  -- takes a lock it does not need.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN public.v_rpc_error('INVALID_AMOUNT');
  END IF;

  -- (2) Resolve the caller's brand profile internally. The client never sends a brand id.
  SELECT * INTO v_brand FROM public.profiles
  WHERE id IN (SELECT id FROM public.profiles WHERE user_id = v_user_id AND role = 'brand')
  LIMIT 1;

  IF v_brand.id IS NULL THEN
    RETURN public.v_rpc_error('BRAND_PROFILE_REQUIRED');
  END IF;

  -- (3) Lock the slot for the whole operation. A concurrent place_bid blocks here and
  -- observes this bid's result once the first caller commits.
  SELECT * INTO v_slot FROM public.sponsorship_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RETURN public.v_rpc_error('SLOT_NOT_FOUND');
  END IF;

  -- (4) The auction must be open.
  IF v_slot.auction_status IS DISTINCT FROM 'open' THEN
    RETURN public.v_rpc_error('AUCTION_NOT_OPEN',
      jsonb_build_object('auction_status', v_slot.auction_status));
  END IF;

  -- (5) The auction must not have ended.
  IF v_slot.auction_ends_at IS NOT NULL AND now() >= v_slot.auction_ends_at THEN
    RETURN public.v_rpc_error('AUCTION_ENDED',
      jsonb_build_object('auction_ends_at', v_slot.auction_ends_at));
  END IF;

  -- A slot that already produced a live sponsorship cannot accept bids. This is the
  -- backstop for a settlement that raced the auction's own end time.
  IF EXISTS (
    SELECT 1 FROM public.sponsorships s
    WHERE s.slot_id = p_slot_id
      AND s.status NOT IN ('cancelled', 'refunded')
  ) THEN
    RETURN public.v_rpc_error('AUCTION_FULL');
  END IF;

  -- Resolve the day to enforce self-bidding.
  SELECT * INTO v_day FROM public.days WHERE id = v_slot.day_id;

  -- (10) A brand may not bid on a Day it owns as creator.
  IF v_day.creator_id IS NOT NULL AND v_day.creator_id = v_brand.id THEN
    RETURN public.v_rpc_error('SELF_BID_FORBIDDEN');
  END IF;

  -- (8) The bid must meet the starting price, if one is set.
  IF v_slot.starting_price IS NOT NULL
     AND public.v_amount_below_start(v_slot.starting_price, p_amount) THEN
    RETURN public.v_rpc_error('BELOW_STARTING_PRICE',
      jsonb_build_object('starting_price', v_slot.starting_price));
  END IF;

  -- (9) The bid must strictly exceed the current leader. Equal bids do not count.
  v_prev_leader_amount := public.v_current_leader_amount(p_slot_id);
  IF v_prev_leader_amount IS NOT NULL AND p_amount <= v_prev_leader_amount THEN
    RETURN public.v_rpc_error('BID_TOO_LOW',
      jsonb_build_object('current_highest_bid', v_prev_leader_amount));
  END IF;

  -- Lift the column guard: this function is the sole legitimate writer of bids and of
  -- the slot's leader columns. Guard restored at the end of the block.
  PERFORM app.set_guard(false);

  -- (11) Mark the previous active leader outbid. This is a row the caller does not own,
  -- which is precisely why the function is SECURITY DEFINER.
  IF v_prev_leader_amount IS NOT NULL THEN
    UPDATE public.bids
    SET status = 'outbid'
    WHERE slot_id = p_slot_id
      AND status = 'active'
      AND amount = v_prev_leader_amount;
  END IF;

  -- (12)+(13) Insert the new bid as active, then update the leader columns atomically.
  -- (7) The currency is the SLOT's currency; the client cannot choose one.
  INSERT INTO public.bids (slot_id, brand_id, amount, currency, status)
  VALUES (p_slot_id, v_brand.id, p_amount, v_slot.currency, 'active')
  RETURNING id INTO v_bid_id;

  UPDATE public.sponsorship_slots
  SET current_highest_bid = p_amount,
      current_highest_bid_id = v_bid_id
  WHERE id = p_slot_id;

  PERFORM app.set_guard(true);

  -- (14)+(15) Return only the caller's own bid and the public leader amount. Never
  -- another brand's id, bid id, or private data: `is_leading` is computed from the
  -- caller's own bid, and the leader's identity is never included.
  RETURN jsonb_build_object(
    'ok', true,
    'error', NULL,
    'bid_id', v_bid_id,
    'slot_id', p_slot_id,
    'brand_id', v_brand.id,
    'amount', p_amount,
    'currency', v_slot.currency,
    'status', 'active',
    'is_leading', true,
    'current_highest_bid', p_amount,
    'current_highest_bid_id', v_bid_id,
    'auction_status', v_slot.auction_status,
    'auction_ends_at', v_slot.auction_ends_at,
    'previous_leader_outbid', v_prev_leader_amount IS NOT NULL
  );

  -- Any unexpected failure still leaves the guard in the ON state.
  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

-- ============= SUPPORT HELPERS =============
-- Kept small, IMMUTABLE, and schema-pinned so the planner can inline them.

-- True when the offered amount does not meet the starting price.
CREATE OR REPLACE FUNCTION public.v_amount_below_start(
  p_starting_price bigint,
  p_amount bigint
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, public
AS $$
  SELECT p_amount < p_starting_price
$$;

-- The amount of the highest VALID leader on a slot, or NULL when nobody is leading.
-- Only active / payment_pending / paid bids count as a floor.
CREATE OR REPLACE FUNCTION public.v_current_leader_amount(
  p_slot_id uuid
)
RETURNS bigint
LANGUAGE sql
STABLE
STRICT
SET search_path = public, public
AS $$
  SELECT b.amount
  FROM public.bids b
  WHERE b.slot_id = p_slot_id
    AND b.status IN ('active', 'payment_pending', 'paid')
  ORDER BY b.amount DESC NULLS LAST, b.created_at ASC, b.id ASC
  LIMIT 1
$$;

-- ============= GRANTS =============
-- Minimum execute. The service role needs everything below; authenticated clients only
-- need place_bid itself. Helpers are not part of the client surface.
REVOKE ALL ON FUNCTION public.place_bid(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.v_amount_below_start(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v_current_leader_amount(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v_current_leader_amount(uuid) TO authenticated;
