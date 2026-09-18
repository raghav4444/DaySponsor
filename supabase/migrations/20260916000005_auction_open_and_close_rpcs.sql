/*
# DaySponsor — auction lifecycle RPCs (Phases 4 and 5)

## open_auction        — authenticated, slot's creator. draft -> open
## close_expired_auction — service role only. Ends an auction and settles it.
## expire_unpaid_winner  — service role only. Falls back to the next bidder.

All three are idempotent. `close_expired_auction` and `expire_unpaid_winner` are
designed to be called by an external scheduler, and to be safe when two schedulers
fire at once: the slot is locked FOR UPDATE for the whole operation, so the second
caller blocks until the first commits and then observes the settled state.supabase --version

## No Stripe from inside the transaction
These functions only mutate database state. They never perform an HTTP call, never
reference a Stripe id, and never depend on one being present. Payment capture is the
webhook's job; the DB records the *obligation* (`payment_pending`) plus a deadline.

## Money
`platform_fee` and `creator_amount` are computed here in pure integer SQL, inside the
same transaction that inserts the sponsorship, so the split is always consistent with
the winning bid amount:

    platform_fee   = floor((amount * 10 + 50) / 100)
    creator_amount = amount - platform_fee

See docs/auction-implementation-contract.md section 4.
*/

-- ============= OPEN AUCTION =============
CREATE OR REPLACE FUNCTION public.open_auction(
  p_slot_id uuid,
  p_starting_price bigint,
  p_currency text,
  p_ends_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_slot public.sponsorship_slots%ROWTYPE;
  v_creator public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN public.v_rpc_error('UNAUTHENTICATED');
  END IF;

  IF p_starting_price IS NULL OR p_starting_price <= 0 THEN
    RETURN public.v_rpc_error('INVALID_STARTING_PRICE');
  END IF;

  IF p_ends_at IS NULL OR p_ends_at <= now() THEN
    RETURN public.v_rpc_error('INVALID_END_TIME');
  END IF;

  -- The currency whitelist is the one the CHECK constraints enforce; validating here
  -- turns a constraint violation into a deterministic code instead of a 23514.
  IF p_currency IS NULL OR p_currency NOT IN ('usd', 'eur', 'gbp') THEN
    RETURN public.v_rpc_error('UNSUPPORTED_CURRENCY',
      jsonb_build_object('currency', p_currency));
  END IF;

  SELECT * INTO v_slot FROM public.sponsorship_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RETURN public.v_rpc_error('SLOT_NOT_FOUND');
  END IF;

  -- Only the Day's creator may open the auction on its slot.
  SELECT * INTO v_creator FROM public.profiles p
  WHERE p.user_id = v_user_id AND p.role = 'creator' AND p.id = (
    SELECT d.creator_id FROM public.days d WHERE d.id = v_slot.day_id
  );

  IF v_creator.id IS NULL THEN
    RETURN public.v_rpc_error('NOT_SLOT_OWNER');
  END IF;

  -- Idempotent: opening an already-open auction is a no-op that returns the live terms.
  IF v_slot.auction_status = 'open' THEN
    RETURN jsonb_build_object('ok', true, 'error', NULL, 'idempotent', true,
      'auction_status', 'open',
      'starting_price', v_slot.starting_price, 'auction_ends_at', v_slot.auction_ends_at);
  END IF;

  -- A settled or cancelled auction is not re-opened; the creator starts a new slot.
  IF v_slot.auction_status IS DISTINCT FROM 'draft' THEN
    RETURN public.v_rpc_error('AUCTION_NOT_DRAFT',
      jsonb_build_object('auction_status', v_slot.auction_status));
  END IF;

  PERFORM app.set_guard(false);

  UPDATE public.sponsorship_slots
  SET auction_status = 'open',
      starting_price = p_starting_price,
      currency = COALESCE(p_currency, 'usd'),
      auction_ends_at = p_ends_at,
      winner_attempt_count = 0,
      current_highest_bid = NULL,
      current_highest_bid_id = NULL,
      winning_bid_id = NULL,
      closed_at = NULL,
      payment_due_at = NULL
  WHERE id = p_slot_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object('ok', true, 'auction_status', 'open',
    'slot_id', p_slot_id, 'starting_price', p_starting_price,
    'currency', COALESCE(p_currency, 'usd'), 'auction_ends_at', p_ends_at);

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.open_auction(uuid, bigint, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_auction(uuid, bigint, text, timestamptz) TO authenticated;

-- ============= SHARED SETTLEMENT HELPERS =============
-- The winner selection. Deterministic tie-breaking, in order:
--   1. highest amount
--   2. earliest created_at
--   3. id (uuid, arbitrary but total)
CREATE OR REPLACE FUNCTION public.v_next_eligible_bid(
  p_slot_id uuid,
  p_exclude_failed boolean
)
RETURNS public.bids
LANGUAGE sql
STABLE
STRICT
SET search_path = public, public
AS $$
  SELECT b.*
  FROM public.bids b
  WHERE b.slot_id = p_slot_id
    AND b.status = 'active'
    AND (NOT p_exclude_failed OR b.status NOT IN ('failed', 'cancelled'))
  ORDER BY b.amount DESC NULLS LAST, b.created_at ASC, b.id ASC
  LIMIT 1
$$;

-- Money split. Documented and deterministic; uses only integer arithmetic.
CREATE OR REPLACE FUNCTION public.v_split_money(
  p_amount bigint
)
RETURNS TABLE (platform_fee bigint, creator_amount bigint)
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, public
AS $$
  SELECT floor((p_amount * 10 + 50) / 100)::bigint AS platform_fee,
         (p_amount - floor((p_amount * 10 + 50) / 100))::bigint AS creator_amount
$$;

-- Payment deadline for a newly selected winner.
CREATE OR REPLACE FUNCTION public.v_payment_deadline(
  p_days integer DEFAULT 3
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, public
AS $$
  SELECT now() + make_interval(days => p_days)
$$;

-- ============= CLOSE EXPIRED AUCTION =============
CREATE OR REPLACE FUNCTION public.close_expired_auction(
  p_slot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_slot public.sponsorship_slots%ROWTYPE;
  v_winner public.bids;
  v_sponsorship public.sponsorships;
  v_fee bigint;
  v_creator_amount bigint;
  v_deadline timestamptz;
  v_day_creator uuid;
  v_new_sponsorship_id uuid;
BEGIN
  -- (1) Lock the slot. A concurrent close blocks here and then observes the settled
  -- state this caller produced.
  SELECT * INTO v_slot FROM public.sponsorship_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RETURN public.v_rpc_error('SLOT_NOT_FOUND');
  END IF;

  -- (15) Idempotency. A slot that is already past the auction stage returns its existing
  -- result instead of re-settling.
  IF v_slot.auction_status IN ('awaiting_payment', 'paid', 'completed', 'cancelled') THEN
    SELECT * INTO v_sponsorship FROM public.sponsorships
    WHERE slot_id = p_slot_id AND winning_bid_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
      'ok', true,
      'error', NULL,
      'idempotent', true,
      'slot_id', p_slot_id,
      'auction_status', v_slot.auction_status,
      'winning_bid_id', v_slot.winning_bid_id,
      'sponsorship_id', v_sponsorship.id,
      'amount', v_sponsorship.amount,
      'currency', v_sponsorship.currency,
      'payment_status', v_sponsorship.payment_status,
      'payment_due_at', v_slot.payment_due_at,
      'attempts', v_slot.winner_attempt_count
    );
  END IF;

  -- (2)+(3) The auction must have ended, and must not still be open to new bids.
  -- A slot still in `draft` never had an auction: that is a caller error, not a close.
  IF v_slot.auction_status = 'draft' THEN
    RETURN public.v_rpc_error('AUCTION_NOT_STARTED');
  END IF;

  IF v_slot.auction_status IS DISTINCT FROM 'open' THEN
    RETURN public.v_rpc_error('AUCTION_NOT_OPEN',
      jsonb_build_object('auction_status', v_slot.auction_status));
  END IF;

  -- New bids are impossible from this point on: place_bid checks the same clock, and the
  -- slot stays open only until this statement flips it.
  IF v_slot.auction_ends_at IS NULL OR now() < v_slot.auction_ends_at THEN
    RETURN public.v_rpc_error('AUCTION_NOT_ENDED',
      jsonb_build_object('auction_ends_at', v_slot.auction_ends_at));
  END IF;

  v_deadline := public.v_payment_deadline(3);

  -- (4) Highest valid bid, deterministic: amount DESC, created_at ASC, id ASC.
  SELECT * INTO v_winner FROM public.bids
  WHERE slot_id = p_slot_id AND status = 'active'
  ORDER BY amount DESC NULLS LAST, created_at ASC, id ASC
  LIMIT 1;

  PERFORM app.set_guard(false);

  -- (6) Every other still-active bid loses.
  UPDATE public.bids
  SET status = 'outbid'
  WHERE slot_id = p_slot_id AND status = 'active'
    AND id IS DISTINCT FROM v_winner.id;

  IF v_winner.id IS NULL THEN
    -- No valid bid: close without creating a sponsorship.
    UPDATE public.sponsorship_slots
    SET auction_status = 'closed', closed_at = now(), payment_due_at = NULL
    WHERE id = p_slot_id;

    PERFORM app.set_guard(true);

    RETURN jsonb_build_object('ok', true, 'error', NULL, 'auction_status', 'closed',
      'slot_id', p_slot_id, 'winning_bid_id', NULL, 'sponsorship_id', NULL,
      'reason', 'no_bids', 'closed_at', now());
  END IF;

  -- (13)+(14) Integer-only split, computed inside this transaction.
  SELECT platform_fee, creator_amount INTO v_fee, v_creator_amount
  FROM public.v_split_money(v_winner.amount);

  SELECT creator_id INTO v_day_creator FROM public.days WHERE id = v_slot.day_id;

  -- (11) Exactly one sponsorship is created.
  INSERT INTO public.sponsorships (
    slot_id, brand_id, creator_id, amount, platform_fee, creator_amount,
    currency, status, payment_status, payment_due_at, winning_bid_id
  )
  VALUES (
    p_slot_id, v_winner.brand_id, v_day_creator,
    v_winner.amount, v_fee, v_creator_amount,
    v_slot.currency, 'payment_pending', 'pending', v_deadline, v_winner.id
  )
  RETURNING id INTO v_new_sponsorship_id;

  -- (7) The winning bid becomes payment_pending.
  UPDATE public.bids SET status = 'payment_pending' WHERE id = v_winner.id;

  -- (8)+(9)+(10) Slot settlement.
  UPDATE public.sponsorship_slots
  SET auction_status = 'awaiting_payment',
      winning_bid_id = v_winner.id,
      closed_at = now(),
      payment_due_at = v_deadline
  WHERE id = p_slot_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object(
    'ok', true,
    'error', NULL,
    'slot_id', p_slot_id,
    'auction_status', 'awaiting_payment',
    'winning_bid_id', v_winner.id,
    'winner_brand_id', v_winner.brand_id,
    'amount', v_winner.amount,
    'platform_fee', v_fee,
    'creator_amount', v_creator_amount,
    'currency', v_slot.currency,
    'payment_status', 'pending',
    'payment_due_at', v_deadline,
    'sponsorship_id', v_new_sponsorship_id,
    'attempts', v_slot.winner_attempt_count
  );

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.close_expired_auction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_expired_auction(uuid) TO authenticated;

-- ============= EXPIRE UNPAID WINNER =============
-- Safe if two scheduled jobs execute simultaneously: the slot is locked, so the second
-- caller observes the post-deadline state the first caller produced and either finds
-- nothing to do or proceeds from the correct next-winner state.
CREATE OR REPLACE FUNCTION public.expire_unpaid_winner(
  p_slot_id uuid,
  p_max_attempts integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_slot public.sponsorship_slots%ROWTYPE;
  v_sponsorship public.sponsorships%ROWTYPE;
  v_next public.bids;
  v_prev_bid public.bids;
  v_fee bigint;
  v_creator_amount bigint;
  v_day_creator uuid;
  v_deadline timestamptz;
  v_attempts integer;
  v_max_attempts integer := COALESCE(p_max_attempts, 3);
BEGIN
  IF v_max_attempts < 1 THEN
    RETURN public.v_rpc_error('INVALID_MAX_ATTEMPTS');
  END IF;

  -- (1) Lock the slot AND the current sponsorship, together. Two schedulers running this
  -- at once cannot both settle: the second blocks on the slot lock and then observes the
  -- state the first produced.
  SELECT * INTO v_slot FROM public.sponsorship_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RETURN public.v_rpc_error('SLOT_NOT_FOUND');
  END IF;

  SELECT * INTO v_sponsorship FROM public.sponsorships
  WHERE slot_id = p_slot_id
    AND status NOT IN ('cancelled', 'refunded')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_sponsorship.id IS NULL OR v_sponsorship.winning_bid_id IS NULL THEN
    RETURN public.v_rpc_error('NOTHING_PENDING',
      jsonb_build_object('reason', 'no active sponsorship with a winner'));
  END IF;

  -- (2)+(3) The deadline must have passed and payment must not have succeeded.
  IF v_sponsorship.payment_due_at IS NULL OR now() < v_sponsorship.payment_due_at THEN
    RETURN public.v_rpc_error('DEADLINE_NOT_PASSED',
      jsonb_build_object('payment_due_at', v_sponsorship.payment_due_at));
  END IF;

  IF v_sponsorship.payment_status = 'paid' THEN
    RETURN public.v_rpc_error('ALREADY_PAID',
      jsonb_build_object('sponsorship_id', v_sponsorship.id));
  END IF;

  v_attempts := COALESCE(v_slot.winner_attempt_count, 0);

  -- (12) Stop after the configured maximum number of attempts.
  IF v_attempts >= v_max_attempts THEN
    PERFORM app.set_guard(false);

    UPDATE public.bids SET status = 'failed'
    WHERE id = v_sponsorship.winning_bid_id;

    -- payment_status lives in the 'pending'/'paid'/'failed'/'refunded' domain (constraint
    -- sponsorships_payment_status_check, migration 20260916000001): a winner that never
    -- paid is 'failed', while `status` carries the lifecycle 'cancelled'.
    UPDATE public.sponsorships
    SET status = 'cancelled', payment_status = 'failed'
    WHERE id = v_sponsorship.id;

    -- (13) No eligible bidder remains: cancel the auction.
    UPDATE public.sponsorship_slots
    SET auction_status = 'cancelled', closed_at = now(), payment_due_at = NULL
    WHERE id = p_slot_id;

    PERFORM app.set_guard(true);

    RETURN jsonb_build_object('ok', true, 'error', NULL, 'cancelled', true,
      'slot_id', p_slot_id, 'auction_status', 'cancelled',
      'reason', 'max_attempts_reached', 'attempts', v_attempts,
      'max_attempts', v_max_attempts, 'failed_bid_id', v_sponsorship.winning_bid_id,
      'cancelled_sponsorship_id', v_sponsorship.id);
  END IF;

  -- (4) The unpaid winner's bid fails.
  SELECT * INTO v_prev_bid FROM public.bids WHERE id = v_sponsorship.winning_bid_id;

  -- (6)+(7) Next-highest eligible bid. 'failed' (never paid / invalidated) and 'cancelled'
  -- bids are excluded; 'outbid' bids ARE eligible — they lost only to a higher bid, and
  -- the payment-pending winner being failed here is exactly the situation a fallback
  -- exists for. 'paid'/'winner' rows belong to settled attempts.
  SELECT * INTO v_next FROM public.bids
  WHERE slot_id = p_slot_id
    AND status IN ('active', 'outbid')
    AND id IS DISTINCT FROM v_sponsorship.winning_bid_id
  ORDER BY amount DESC NULLS LAST, created_at ASC, id ASC
  LIMIT 1;

  PERFORM app.set_guard(false);

  UPDATE public.bids SET status = 'failed' WHERE id = v_sponsorship.winning_bid_id;

  -- (5) The payment-pending sponsorship is cancelled. payment_status is 'failed' — the
  -- never-paid domain value — while `status` carries the lifecycle 'cancelled'.
  UPDATE public.sponsorships
  SET status = 'cancelled', payment_status = 'failed'
  WHERE id = v_sponsorship.id;

  v_attempts := v_attempts + 1;

  IF v_next.id IS NULL THEN
    -- (13) No eligible bidder remains.
    UPDATE public.sponsorship_slots
    SET auction_status = 'cancelled', closed_at = now(),
        payment_due_at = NULL, winner_attempt_count = v_attempts
    WHERE id = p_slot_id;

    PERFORM app.set_guard(true);

    RETURN jsonb_build_object('ok', true, 'error', NULL, 'cancelled', true,
      'slot_id', p_slot_id, 'auction_status', 'cancelled',
      'reason', 'no_eligible_bidder', 'attempts', v_attempts,
      'failed_bid_id', v_sponsorship.winning_bid_id,
      'cancelled_sponsorship_id', v_sponsorship.id);
  END IF;

  -- (10) Recalculate the split for the new winner.
  SELECT platform_fee, creator_amount INTO v_fee, v_creator_amount
  FROM public.v_split_money(v_next.amount);

  SELECT creator_id INTO v_day_creator FROM public.days WHERE id = v_slot.day_id;
  v_deadline := public.v_payment_deadline(3);

  -- (9) Reuse the slot's one live sponsorship row when one is available, so the
  -- `sponsorships_one_active_per_slot` invariant keeps holding; the amounts are
  -- overwritten with the new winner's split.
  INSERT INTO public.sponsorships (
    slot_id, brand_id, creator_id, amount, platform_fee, creator_amount,
    currency, status, payment_status, payment_due_at, winning_bid_id
  )
  VALUES (
    p_slot_id, v_next.brand_id, v_day_creator,
    v_next.amount, v_fee, v_creator_amount,
    v_slot.currency, 'payment_pending', 'pending', v_deadline, v_next.id
  )
  ON CONFLICT (slot_id) WHERE status NOT IN ('cancelled', 'refunded')
  DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    amount = EXCLUDED.amount,
    platform_fee = EXCLUDED.platform_fee,
    creator_amount = EXCLUDED.creator_amount,
    currency = EXCLUDED.currency,
    status = 'payment_pending',
    payment_status = 'pending',
    payment_due_at = EXCLUDED.payment_due_at,
    winning_bid_id = EXCLUDED.winning_bid_id,
    stripe_payment_intent_id = NULL,
    stripe_charge_id = NULL,
    paid_at = NULL,
    updated_at = now();

  -- (8) The next bid becomes payment_pending.
  UPDATE public.bids SET status = 'payment_pending' WHERE id = v_next.id;

  -- (11) New deadline and attempt count.
  UPDATE public.sponsorship_slots
  SET winning_bid_id = v_next.id,
      payment_due_at = v_deadline,
      winner_attempt_count = v_attempts
  WHERE id = p_slot_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object(
    'ok', true,
    'error', NULL,
    'fallback', true,
    'slot_id', p_slot_id,
    'auction_status', 'awaiting_payment',
    'winning_bid_id', v_next.id,
    'winner_brand_id', v_next.brand_id,
    'amount', v_next.amount,
    'platform_fee', v_fee,
    'creator_amount', v_creator_amount,
    'currency', v_slot.currency,
    'payment_status', 'pending',
    'payment_due_at', v_deadline,
    'attempts', v_attempts
  );

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unpaid_winner(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_winner(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.v_next_eligible_bid(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v_split_money(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v_payment_deadline(integer) FROM PUBLIC, anon;
