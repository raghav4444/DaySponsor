-- ============================================================================
-- Suite 01 — atomic bid placement (Phase 3) and the place_bid return contract.
--
-- The seed leaves the slot auction OPEN with starting_price 5000 (eur), no bids, no
-- sponsorship, so this suite starts from a live auction.
--
-- Identity: test.call_as(uid, sql) runs the statement as the `authenticated` role with
-- that uid (so RLS and the guard triggers are in force) and hands the RPC's jsonb back,
-- which is how both the EFFECT and the PAYLOAD are asserted.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ------------------------------------------------------- valid first bid + payload
-- One call, kept in a temp table so every field of the documented payload is asserted.
CREATE TEMP TABLE r1 AS
SELECT test.call_as(test.id('brand_a_auth'),
  $$ SELECT public.place_bid(test.id('slot_id'), 5000) $$) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM r1), 'first_bid_accepted');
SELECT test.assert_eq('true', (SELECT ((j->>'error') IS NULL)::text FROM r1), 'no_error_field');
SELECT test.assert_eq('true', (SELECT ((j->>'bid_id') IS NOT NULL)::text FROM r1), 'payload_has_bid_id');
SELECT test.assert_eq(test.id('slot_id')::text, (SELECT j->>'slot_id' FROM r1), 'payload_slot_id');
SELECT test.assert_eq(test.id('brand_a_uid')::text, (SELECT j->>'brand_id' FROM r1), 'payload_own_brand_id');
SELECT test.assert_eq('5000', (SELECT j->>'amount' FROM r1), 'payload_amount');
SELECT test.assert_eq('eur', (SELECT j->>'currency' FROM r1), 'payload_uses_slot_currency');
SELECT test.assert_eq('active', (SELECT j->>'status' FROM r1), 'payload_status_active');
SELECT test.assert_eq('true', (SELECT j->>'is_leading' FROM r1), 'payload_is_leading');
SELECT test.assert_eq('5000', (SELECT j->>'current_highest_bid' FROM r1), 'payload_leader_amount');
SELECT test.assert_eq('true',
  (SELECT ((j->>'current_highest_bid_id') = (j->>'bid_id'))::text FROM r1), 'payload_leader_is_this_bid');
SELECT test.assert_eq('open', (SELECT j->>'auction_status' FROM r1), 'payload_auction_status');
SELECT test.assert_eq('false', (SELECT j->>'previous_leader_outbid' FROM r1), 'no_previous_leader');
-- No other brand's identity, and no settlement column, may appear in the payload.
SELECT test.assert_eq('false',
  (SELECT (j::text LIKE '%' || test.id('brand_b_uid')::text || '%')::text FROM r1), 'payload_hides_other_brand');
SELECT test.assert_eq('false',
  (SELECT (j::text LIKE '%' || test.id('brand_c_uid')::text || '%')::text FROM r1), 'payload_hides_third_brand');
SELECT test.assert_eq('false',
  (SELECT ((j ? 'stripe_payment_intent_id' OR j ? 'stripe_charge_id'))::text FROM r1), 'payload_has_no_stripe_ids');

-- ...and the effects it promises.
SELECT test.assert_eq('5000',
  (SELECT current_highest_bid::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'highest_is_5000');
SELECT test.assert_eq((SELECT j->>'bid_id' FROM r1),
  (SELECT current_highest_bid_id::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'slot_points_at_bid');
SELECT test.assert_eq('eur',
  (SELECT currency FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'), 'bid_row_currency');
-- ---------------------------------------------------------- below starting price
SELECT test.assert_eq('BELOW_STARTING_PRICE',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 1000) $$))->>'error', 'below_starting_price_rejected');
SELECT test.assert_eq('5000',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 1000) $$))->>'starting_price', 'below_start_context');

-- ------------------------------------------------------- equal to current highest
SELECT test.assert_eq('BID_TOO_LOW',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 5000) $$))->>'error', 'equal_bid_rejected');
SELECT test.assert_eq('5000',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 5000) $$))->>'current_highest_bid', 'too_low_context');

-- ------------------------------------------------------------ negative and zero
SELECT test.assert_eq('INVALID_AMOUNT',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), -100) $$))->>'error', 'negative_bid_rejected');
SELECT test.assert_eq('INVALID_AMOUNT',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 0) $$))->>'error', 'zero_bid_rejected');

-- ------------------------------------------------------------ unauthenticated
SELECT test.assert_eq('UNAUTHENTICATED',
  (test.call_as(NULL, $$ SELECT public.place_bid(test.id('slot_id'), 12000) $$))->>'error',
  'anonymous_rejected');

-- ------------------------------------------------------- missing brand profile
-- The creator is authenticated but has no brand profile: the RPC resolves the brand from
-- auth.uid() and must refuse rather than fall back to something else.
SELECT test.assert_eq('BRAND_PROFILE_REQUIRED',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 12000) $$))->>'error', 'non_brand_rejected');

-- --------------------------------------------------------------- unknown slot
SELECT test.assert_eq('SLOT_NOT_FOUND',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid('00000000-0000-0000-0000-0000000000ff'::uuid, 12000) $$))->>'error',
  'unknown_slot_rejected');

-- ------------------------------------ a legal raise: the leader moves, and it is public
CREATE TEMP TABLE r2 AS
SELECT test.call_as(test.id('brand_b_auth'),
  $$ SELECT public.place_bid(test.id('slot_id'), 7500) $$) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM r2), 'brand_b_bid_accepted');
SELECT test.assert_eq('true', (SELECT j->>'previous_leader_outbid' FROM r2), 'leader_outbid_flagged');
SELECT test.assert_eq('7500',
  (SELECT current_highest_bid::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'highest_now_7500');
SELECT test.assert_eq((SELECT j->>'bid_id' FROM r2),
  (SELECT current_highest_bid_id::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'leader_is_brand_b_bid');
SELECT test.assert_eq('outbid',
  (SELECT status FROM bids WHERE slot_id = test.id('slot_id') AND amount = 5000), 'previous_leader_now_outbid');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'), 'exactly_one_active');

-- brand A cannot repeat brand B's amount either, but one unit more is accepted
SELECT test.assert_eq('BID_TOO_LOW',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 7500) $$))->>'error', 'non_ascending_rejected');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 7501) $$))->>'ok', 'one_unit_raise_accepted');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'), 'still_one_active');

ROLLBACK;