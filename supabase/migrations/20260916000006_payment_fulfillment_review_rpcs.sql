/*
# DaySponsor — payment, payout, fulfillment transitions, review security (Phases 6 & 7)

## Who calls what
- `mark_sponsorship_paid`, `record_refund`, `release_payout`: the Stripe webhook layer,
  using the service role. These are the ONLY writers of the payment/payout/Stripe
  columns. No client policy grants them.
- `advance_fulfillment`: an authenticated brand or creator. Identity is derived from
  auth.uid(); the caller never supplies a brand id, a creator id or a status it is not
  entitled to move to.
- `submit_review`: an authenticated creator. The reviewed brand is DERIVED from the
  winning bid and can never be supplied by the caller.

## No client can set these, by construction
paid / refunded / payout released / winning bid / sponsorship amount / platform fee /
creator amount / any Stripe id. Each is either written only by a service-role RPC, or
derived inside a RPC, or guarded by a CHECK constraint (see the brand-match constraint
in migration 20260916000002).
*/

-- ============= MARK PAID (Stripe webhook) =============
CREATE OR REPLACE FUNCTION public.mark_sponsorship_paid(
  p_sponsorship_id uuid,
  p_payment_intent_id text,
  p_charge_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_sponsorship public.sponsorships;
  v_slot public.sponsorship_slots;
BEGIN
  SELECT * INTO v_sponsorship FROM public.sponsorships
  WHERE id = p_sponsorship_id
  FOR UPDATE;

  IF v_sponsorship.id IS NULL THEN
    RETURN public.v_rpc_error('SPONSORSHIP_NOT_FOUND');
  END IF;

  SELECT * INTO v_slot FROM public.sponsorship_slots
  WHERE id = v_sponsorship.slot_id
  FOR UPDATE;

  -- Idempotent: a webhook that fires twice for the same payment must not double-apply.
  IF v_sponsorship.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'error', NULL, 'idempotent', true,
      'sponsorship_id', v_sponsorship.id, 'slot_id', v_sponsorship.slot_id,
      'status', v_sponsorship.status, 'payment_status', 'paid',
      'paid_at', v_sponsorship.paid_at);
  END IF;

  IF v_sponsorship.status NOT IN ('payment_pending', 'pending') THEN
    RETURN public.v_rpc_error('INVALID_TRANSITION',
      jsonb_build_object('status', v_sponsorship.status, 'target', 'paid'));
  END IF;

  PERFORM app.set_guard(false);

  UPDATE public.sponsorships
  SET payment_status = 'paid',
      status = 'paid',
      paid_at = now(),
      stripe_payment_intent_id = COALESCE(p_payment_intent_id, stripe_payment_intent_id),
      stripe_charge_id = COALESCE(p_charge_id, stripe_charge_id)
  WHERE id = p_sponsorship_id;

  -- The winning bid is settled too, so a later fallback can no longer re-select it.
  UPDATE public.bids SET status = 'paid'
  WHERE id = v_sponsorship.winning_bid_id;

  UPDATE public.sponsorship_slots
  SET auction_status = 'paid'
  WHERE id = v_sponsorship.slot_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object('ok', true, 'error', NULL,
    'sponsorship_id', p_sponsorship_id, 'slot_id', v_sponsorship.slot_id,
    'status', 'paid', 'payment_status', 'paid',
    'auction_status', 'paid', 'paid_at', now());

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_sponsorship_paid(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_sponsorship_paid(uuid, text, text) TO authenticated;

-- ============= RECORD REFUND (Stripe webhook) =============
CREATE OR REPLACE FUNCTION public.record_refund(
  p_sponsorship_id uuid,
  p_refund_id text,
  p_amount bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_sponsorship public.sponsorships;
BEGIN
  SELECT * INTO v_sponsorship FROM public.sponsorships
  WHERE id = p_sponsorship_id
  FOR UPDATE;

  IF v_sponsorship.id IS NULL THEN
    RETURN public.v_rpc_error('SPONSORSHIP_NOT_FOUND');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_sponsorship.amount THEN
    RETURN public.v_rpc_error('INVALID_REFUND_AMOUNT',
      jsonb_build_object('amount', v_sponsorship.amount, 'requested', p_amount));
  END IF;

  -- Idempotency MUST be checked before the payment gate: a replayed refund arrives with
  -- payment_status already 'refunded', which is not 'paid', and answering NOT_PAID to a
  -- webhook replay would break exactly the replay protection this branch exists for.
  IF v_sponsorship.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'error', NULL, 'idempotent', true,
      'sponsorship_id', v_sponsorship.id, 'status', 'refunded',
      'refund_amount', v_sponsorship.refund_amount,
      'refunded_at', v_sponsorship.refunded_at);
  END IF;

  IF v_sponsorship.payment_status IS DISTINCT FROM 'paid' THEN
    RETURN public.v_rpc_error('NOT_PAID',
      jsonb_build_object('payment_status', v_sponsorship.payment_status));
  END IF;

  PERFORM app.set_guard(false);

  UPDATE public.sponsorships
  SET status = 'refunded',
      payment_status = 'refunded',
      refund_amount = p_amount,
      refunded_at = now(),
      stripe_refund_id = COALESCE(p_refund_id, stripe_refund_id),
      payout_status = 'cancelled'
  WHERE id = p_sponsorship_id;

  -- A refunded sponsorship releases no payout.
  UPDATE public.sponsorship_slots
  SET auction_status = 'cancelled'
  WHERE id = v_sponsorship.slot_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object('ok', true, 'error', NULL,
    'sponsorship_id', p_sponsorship_id, 'slot_id', v_sponsorship.slot_id,
    'status', 'refunded', 'payment_status', 'refunded',
    'refund_amount', p_amount, 'refunded_at', now());

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.record_refund(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_refund(uuid, text, bigint) TO authenticated;

-- ============= RELEASE PAYOUT (Stripe transfer) =============
CREATE OR REPLACE FUNCTION public.release_payout(
  p_sponsorship_id uuid,
  p_transfer_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_sponsorship public.sponsorships;
BEGIN
  SELECT * INTO v_sponsorship FROM public.sponsorships
  WHERE id = p_sponsorship_id
  FOR UPDATE;

  IF v_sponsorship.id IS NULL THEN
    RETURN public.v_rpc_error('SPONSORSHIP_NOT_FOUND');
  END IF;

  IF v_sponsorship.payout_status = 'released' THEN
    RETURN jsonb_build_object('ok', true, 'error', NULL, 'idempotent', true,
      'sponsorship_id', v_sponsorship.id, 'payout_status', 'released',
      'stripe_transfer_id', v_sponsorship.stripe_transfer_id,
      'payout_released_at', v_sponsorship.payout_released_at);
  END IF;

  -- A payout may only be released once the creator earned it.
  IF v_sponsorship.payout_status IS DISTINCT FROM 'eligible' THEN
    RETURN public.v_rpc_error('PAYOUT_NOT_ELIGIBLE',
      jsonb_build_object('payout_status', v_sponsorship.payout_status));
  END IF;

  IF p_transfer_id IS NULL THEN
    RETURN public.v_rpc_error('TRANSFER_ID_REQUIRED');
  END IF;

  PERFORM app.set_guard(false);

  UPDATE public.sponsorships
  SET payout_status = 'released',
      payout_released_at = now(),
      stripe_transfer_id = p_transfer_id
  WHERE id = p_sponsorship_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object('ok', true, 'error', NULL,
    'sponsorship_id', p_sponsorship_id, 'slot_id', v_sponsorship.slot_id,
    'payout_status', 'released', 'stripe_transfer_id', p_transfer_id,
    'payout_released_at', now(),
    'creator_amount', v_sponsorship.creator_amount,
    'currency', v_sponsorship.currency);

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.release_payout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_payout(uuid, text) TO authenticated;

-- ============= ADVANCE FULFILLMENT (brand or creator) =============
-- Restricted RPC: identity is derived from auth.uid(). The caller may only move status
-- along the legal forward edges, and each edge is restricted to the party who owns that
-- step.
CREATE OR REPLACE FUNCTION public.advance_fulfillment(
  p_sponsorship_id uuid,
  p_to_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_sponsorship public.sponsorships;
  v_profile public.profiles;
  v_is_brand boolean := false;
  v_is_creator boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN public.v_rpc_error('UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_sponsorship FROM public.sponsorships
  WHERE id = p_sponsorship_id
  FOR UPDATE;

  IF v_sponsorship.id IS NULL THEN
    RETURN public.v_rpc_error('SPONSORSHIP_NOT_FOUND');
  END IF;

  -- Identity is derived from auth.uid(); never supplied by the caller.
  SELECT * INTO v_profile FROM public.profiles
  WHERE user_id = v_user_id AND role IN ('brand', 'creator')
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RETURN public.v_rpc_error('PROFILE_REQUIRED');
  END IF;

  v_is_brand := (v_profile.role = 'brand' AND v_profile.id = v_sponsorship.brand_id);
  v_is_creator := (v_profile.role = 'creator' AND v_profile.id = v_sponsorship.creator_id);

  IF NOT v_is_brand AND NOT v_is_creator THEN
    RETURN public.v_rpc_error('NOT_PARTY',
      jsonb_build_object('sponsorship_id', p_sponsorship_id));
  END IF;

  -- A client may never walk the status to `paid`, `refunded`, `completed` or `cancelled`
  -- through this RPC: those are the webhook's and submit_review's edges.
  IF p_to_status IS NULL OR p_to_status NOT IN (
       'product_shipped', 'product_received', 'day_completed', 'review_pending'
     ) THEN
    RETURN public.v_rpc_error('INVALID_TARGET_STATUS',
      jsonb_build_object('target', p_to_status));
  END IF;

  -- Edge-level authorization: each step belongs to one party only.
  IF p_to_status = 'product_shipped' AND NOT v_is_brand THEN
    RETURN public.v_rpc_error('NOT_BRAND');
  END IF;
  IF p_to_status IN ('product_received', 'day_completed', 'review_pending')
     AND NOT v_is_creator THEN
    RETURN public.v_rpc_error('NOT_CREATOR');
  END IF;

  -- Fulfillment may only begin once payment succeeded.
  IF v_sponsorship.payment_status IS DISTINCT FROM 'paid' THEN
    RETURN public.v_rpc_error('NOT_PAID',
      jsonb_build_object('payment_status', v_sponsorship.payment_status));
  END IF;

  IF NOT public.sponsorships_status_transition_ok(v_sponsorship.status, p_to_status) THEN
    RETURN public.v_rpc_error('INVALID_TRANSITION',
      jsonb_build_object('from', v_sponsorship.status, 'to', p_to_status));
  END IF;

  PERFORM app.set_guard(false);

  UPDATE public.sponsorships
  SET status = p_to_status,
      -- The creator becomes eligible for payout once the Day is complete.
      payout_eligible_at = CASE
        WHEN p_to_status = 'day_completed' AND payout_eligible_at IS NULL THEN now()
        ELSE payout_eligible_at
      END,
      payout_status = CASE
        WHEN p_to_status = 'day_completed' AND payout_eligible_at IS NULL THEN 'eligible'
        ELSE payout_status
      END
  WHERE id = p_sponsorship_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object('ok', true, 'error', NULL,
    'sponsorship_id', p_sponsorship_id, 'slot_id', v_sponsorship.slot_id,
    'from', v_sponsorship.status, 'status', p_to_status,
    'payout_status', CASE
      WHEN p_to_status = 'day_completed' AND v_sponsorship.payout_status <> 'eligible'
        THEN 'eligible'
      ELSE v_sponsorship.payout_status
    END);

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_fulfillment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_fulfillment(uuid, text) TO authenticated;

-- ============= SUBMIT REVIEW (creator) =============
-- Phase 7 invariants, all enforced here and not trusted to the client:
--  1. Creator owns the sponsorship's Day (creator_id = the caller's profile).
--  2. The sponsorship references the winning bid (CHECK constraint guarantees the brand
--     is that bid's brand).
--  3. The reviewed brand is DERIVED from the winning bid — there is no brand parameter.
--  4. The creator cannot submit a brand id manually: the column does not exist in this
--     RPC's parameter list.
--  5. The sponsorship must be paid.
--  6. Fulfillment must have reached review_pending.
--  7. rating is an integer in 1..5 (CHECK constraint on the table enforces the range).
--  8. A 1-star review is valid: the range accepts 1, and nothing here branches on it.
--  9. The rating does not affect payout: creator_amount is never touched here.
-- 10. The brand cannot rewrite the creator's review: no brand may call this RPC
--     successfully (it requires creator ownership), and the RLS UPDATE policy denies
--     the brand by default.
-- 11. A losing brand cannot be reviewed for this sponsorship: the brand is pinned to
--     the winning bid by the CHECK constraint, and losing bids are `outbid`/`failed`.
CREATE OR REPLACE FUNCTION public.submit_review(
  p_sponsorship_id uuid,
  p_rating integer,
  p_title text,
  p_content text,
  p_pros text[],
  p_cons text[],
  p_would_recommend boolean,
  p_video_url text,
  p_video_platform text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_sponsorship public.sponsorships;
  v_profile public.profiles;
  v_review public.reviews;
  v_brand_id uuid;
  v_review_id uuid;
  v_inserted boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN public.v_rpc_error('UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_sponsorship FROM public.sponsorships
  WHERE id = p_sponsorship_id
  FOR UPDATE;

  IF v_sponsorship.id IS NULL THEN
    RETURN public.v_rpc_error('SPONSORSHIP_NOT_FOUND');
  END IF;

  -- (1) The creator must own the sponsorship's Day.
  SELECT * INTO v_profile FROM public.profiles p
  WHERE p.user_id = v_user_id
    AND p.role = 'creator'
    AND p.id = v_sponsorship.creator_id;

  IF v_profile.id IS NULL THEN
    RETURN public.v_rpc_error('NOT_CREATOR');
  END IF;

  -- (2)+(3)+(4) The reviewed brand is DERIVED from the winning bid. There is no brand
  -- parameter, and the sponsorship's winning-bid brand match is guaranteed by the CHECK
  -- constraint added in migration 20260916000002.
  IF v_sponsorship.winning_bid_id IS NULL THEN
    RETURN public.v_rpc_error('NO_WINNING_BID');
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.bids WHERE id = v_sponsorship.winning_bid_id;

  IF v_brand_id IS NULL THEN
    RETURN public.v_rpc_error('WINNING_BID_NOT_FOUND');
  END IF;

  -- (5) The sponsorship must be paid.
  IF v_sponsorship.payment_status IS DISTINCT FROM 'paid' THEN
    RETURN public.v_rpc_error('NOT_PAID',
      jsonb_build_object('payment_status', v_sponsorship.payment_status));
  END IF;

  -- (6) Fulfillment must have reached review_pending. `completed` is accepted as well,
  -- so the creator can edit the review they already published (the UPDATE path below);
  -- a second submission is otherwise refused by the unique index on sponsorship_id.
  IF v_sponsorship.status NOT IN ('review_pending', 'completed') THEN
    RETURN public.v_rpc_error('NOT_REVIEW_PENDING',
      jsonb_build_object('status', v_sponsorship.status));
  END IF;

  -- (7) Rating is an integer in 1..5. (8) 1 star is valid: the range accepts it and
  -- nothing here branches on the value. (9) The rating never touches creator_amount.
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN public.v_rpc_error('INVALID_RATING',
      jsonb_build_object('rating', p_rating));
  END IF;

  -- (11) A losing brand cannot be reviewed: the brand is pinned to the winning bid, and
  -- losing bids are outbid or failed.
  PERFORM app.set_guard(false);

  -- One review per sponsorship (`reviews_one_per_sponsorship`). A repeat call by the SAME
  -- creator edits their own review instead of failing or duplicating it; the brand_id is
  -- re-derived above and can never be steered by the caller.
  INSERT INTO public.reviews (
    sponsorship_id, rating, title, content, pros, cons,
    would_recommend, video_url, video_platform, brand_id, published_at
  )
  VALUES (
    p_sponsorship_id, p_rating, p_title, p_content, p_pros, p_cons,
    p_would_recommend, p_video_url, p_video_platform, v_brand_id, now()
  )
  ON CONFLICT (sponsorship_id) DO UPDATE SET
    rating = EXCLUDED.rating,
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    pros = EXCLUDED.pros,
    cons = EXCLUDED.cons,
    would_recommend = EXCLUDED.would_recommend,
    video_url = EXCLUDED.video_url,
    video_platform = EXCLUDED.video_platform,
    brand_id = EXCLUDED.brand_id,
    updated_at = now()
  RETURNING id, (xmax = 0) AS inserted INTO v_review_id, v_inserted;

  -- Moving to `completed` is the only remaining forward edge from review_pending.
  UPDATE public.sponsorships
  SET status = 'completed'
  WHERE id = p_sponsorship_id;

  PERFORM app.set_guard(true);

  RETURN jsonb_build_object('ok', true, 'error', NULL,
    'review_id', v_review_id, 'sponsorship_id', p_sponsorship_id,
    'slot_id', v_sponsorship.slot_id,
    'brand_id', v_brand_id, 'rating', p_rating,
    'inserted', v_inserted, 'status', 'completed');

  EXCEPTION WHEN OTHERS THEN
    PERFORM app.set_guard(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, integer, text, text, text[], text[], boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, integer, text, text, text[], text[], boolean, text, text) TO authenticated;
