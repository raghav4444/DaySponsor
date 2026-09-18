-- ============================================================================
-- Suite 04 — unpaid-winner fallback (Phase 5), sponsorship transitions (Phase 6),
-- payout release, and review security (Phase 7).
--
-- Service-role RPCs (mark_sponsorship_paid, record_refund, release_payout,
-- close_expired_auction, expire_unpaid_winner) are invoked here by the OWNER, standing in
-- for the Stripe webhook layer and the scheduler. That they are NOT callable by a browser
-- client is asserted separately in 05_security_rls.sql and 06_security.sql.
-- ============================================================================
\set ON_ERROR_STOP on

-- ============================================================================
-- A. Fallback chain: deadline not passed → next bidder wins → max attempts → cancelled.
-- ============================================================================
BEGIN;

SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 25000) $$))->>'ok', 'fallback_bid_b');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 30000) $$))->>'ok', 'fallback_bid_a');

UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');

CREATE TEMP TABLE f0 AS SELECT public.close_expired_auction(test.id('slot_id')) AS j;
SELECT test.assert_eq('true', (SELECT j->>'ok' FROM f0), 'fallback_close_ok');
SELECT test.assert_eq('30000', (SELECT amount::text FROM sponsorships WHERE slot_id = test.id('slot_id')),
  'fallback_initial_amount');

-- (2) The deadline has not passed yet: nothing to do.
SELECT test.assert_eq('DEADLINE_NOT_PASSED',
  (public.expire_unpaid_winner(test.id('slot_id'), 3))->>'error', 'deadline_not_passed');
SELECT test.assert_eq('payment_pending',
  (SELECT status FROM sponsorships WHERE slot_id = test.id('slot_id')), 'nothing_changed_yet');

-- (3) Arrange a deadline that has passed. No client path can move a payment deadline,
-- which is the point of the check, so the owner arranges it.
SELECT test.as_owner($$
  UPDATE sponsorship_slots SET payment_due_at = now() - INTERVAL '2 minutes' WHERE id = test.id('slot_id');
  UPDATE sponsorships SET payment_due_at = now() - INTERVAL '2 minutes' WHERE slot_id = test.id('slot_id'); $$);

CREATE TEMP TABLE f1 AS SELECT public.expire_unpaid_winner(test.id('slot_id'), 3) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM f1), 'fallback_ok');
SELECT test.assert_eq('true', (SELECT j->>'fallback' FROM f1), 'fallback_flagged');
SELECT test.assert_eq(test.id('brand_b_uid')::text, (SELECT j->>'winner_brand_id' FROM f1), 'fallback_next_brand');
SELECT test.assert_eq('25000', (SELECT j->>'amount' FROM f1), 'fallback_recalculates_amount');
SELECT test.assert_eq('2500', (SELECT j->>'platform_fee' FROM f1), 'fallback_recalculates_fee');
SELECT test.assert_eq('22500', (SELECT j->>'creator_amount' FROM f1), 'fallback_recalculates_creator_amount');
SELECT test.assert_eq('1', (SELECT j->>'attempts' FROM f1), 'fallback_counts_attempt');
SELECT test.assert_eq('true', (SELECT ((j->>'payment_due_at') IS NOT NULL)::text FROM f1), 'fallback_sets_new_deadline');

-- The unpaid winner's bid failed, and its sponsorship was cancelled rather than reused.
SELECT test.assert_eq('failed',
  (SELECT status FROM bids WHERE slot_id = test.id('slot_id') AND amount = 30000), 'unpaid_winner_failed');
SELECT test.assert_eq('cancelled',
  (SELECT status FROM sponsorships WHERE slot_id = test.id('slot_id') AND amount = 30000),
  'unpaid_sponsorship_cancelled');
SELECT test.assert_eq('failed',
  (SELECT payment_status FROM sponsorships WHERE slot_id = test.id('slot_id') AND amount = 30000),
  'unpaid_payment_status_failed');
-- The next-highest eligible bid took over, on a fresh sponsorship row.
SELECT test.assert_eq('payment_pending',
  (SELECT status FROM bids WHERE slot_id = test.id('slot_id') AND amount = 25000), 'next_bid_payment_pending');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM sponsorships WHERE slot_id = test.id('slot_id') AND status NOT IN ('cancelled', 'refunded')),
  'one_live_sponsorship_after_fallback');
SELECT test.assert_eq(test.id('brand_b_uid')::text,
  (SELECT brand_id::text FROM sponsorships WHERE slot_id = test.id('slot_id') AND status NOT IN ('cancelled', 'refunded')),
  'live_sponsorship_is_next_brand');
SELECT test.assert_eq('25000',
  (SELECT amount::text FROM sponsorships WHERE slot_id = test.id('slot_id') AND status NOT IN ('cancelled', 'refunded')),
  'live_sponsorship_amount');
SELECT test.assert_eq('22500',
  (SELECT creator_amount::text FROM sponsorships WHERE slot_id = test.id('slot_id') AND status NOT IN ('cancelled', 'refunded')),
  'live_sponsorship_creator_amount');
SELECT test.assert_eq('true',
  (SELECT (creator_amount = amount - platform_fee)::text FROM sponsorships
   WHERE slot_id = test.id('slot_id') AND status NOT IN ('cancelled', 'refunded')), 'live_split_consistent');
SELECT test.assert_eq('1',
  (SELECT winner_attempt_count::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'attempt_count_persisted');
SELECT test.assert_eq('awaiting_payment',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'auction_still_awaiting_payment');
SELECT test.assert_eq(
  (SELECT winning_bid_id::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  (SELECT id::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending'),
  'slot_points_at_new_winner');

-- The new deadline is in the future: the scheduler has nothing to do yet.
SELECT test.assert_eq('DEADLINE_NOT_PASSED',
  (public.expire_unpaid_winner(test.id('slot_id'), 3))->>'error', 'second_deadline_not_passed');

-- (12) Maximum attempts reached: the auction is cancelled instead of looping forever.
SELECT test.as_owner($$
  UPDATE sponsorship_slots SET payment_due_at = now() - INTERVAL '2 minutes' WHERE id = test.id('slot_id');
  UPDATE sponsorships SET payment_due_at = now() - INTERVAL '2 minutes' WHERE slot_id = test.id('slot_id'); $$);

CREATE TEMP TABLE f2 AS SELECT public.expire_unpaid_winner(test.id('slot_id'), 1) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM f2), 'max_attempts_ok');
SELECT test.assert_eq('true', (SELECT j->>'cancelled' FROM f2), 'max_attempts_cancelled');
SELECT test.assert_eq('max_attempts_reached', (SELECT j->>'reason' FROM f2), 'max_attempts_reason');
SELECT test.assert_eq('cancelled',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'auction_cancelled_after_max');
SELECT test.assert_eq('true',
  (SELECT (payment_due_at IS NULL)::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'deadline_cleared');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM sponsorships WHERE slot_id = test.id('slot_id') AND status NOT IN ('cancelled', 'refunded')),
  'no_live_sponsorship_after_max');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status IN ('active', 'payment_pending')),
  'no_eligible_bid_left');

ROLLBACK;

-- ============================================================================
-- B. Payment via the webhook RPC, the guarded fulfillment chain, payout release, and
-- review submission — one transaction, because each step is the next step's precondition.
-- ============================================================================
BEGIN;

SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 25000) $$))->>'ok', 'b_setup_bid_b');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 30000) $$))->>'ok', 'b_setup_bid_a');
UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');
SELECT test.assert_eq('true', (public.close_expired_auction(test.id('slot_id')))->>'ok', 'b_setup_close');

CREATE TEMP TABLE p AS SELECT id FROM sponsorships WHERE slot_id = test.id('slot_id');

-- -------------------------------------------------- fulfillment before payment is refused
SELECT test.assert_eq('NOT_PAID',
  (test.call_as(test.id('brand_a_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_shipped')))->>'error',
  'fulfillment_before_payment_rejected');

-- --------------------------------------------------- payout before eligibility is refused
SELECT test.assert_eq('PAYOUT_NOT_ELIGIBLE',
  (public.release_payout((SELECT id FROM p), 'tr_test_1'))->>'error', 'payout_before_eligible_rejected');

-- --------------------------------------------------- each edge belongs to one party only
SELECT test.assert_eq('NOT_BRAND',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_shipped')))->>'error',
  'creator_cannot_ship');
SELECT test.assert_eq('PROFILE_REQUIRED',
  (test.call_as(test.id('admin_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_received')))->>'error',
  'non_party_rejected');
SELECT test.assert_eq('UNAUTHENTICATED',
  (test.call_as(NULL,
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_shipped')))->>'error',
  'anonymous_fulfillment_rejected');

-- ------------------------------------------------------------- the payment is recorded
CREATE TEMP TABLE paid AS
SELECT public.mark_sponsorship_paid((SELECT id FROM p), 'pi_test_1', 'ch_test_1') AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM paid), 'mark_paid_ok');
SELECT test.assert_eq('paid', (SELECT j->>'payment_status' FROM paid), 'mark_paid_payload_payment_status');
SELECT test.assert_eq('paid', (SELECT j->>'status' FROM paid), 'mark_paid_payload_status');
SELECT test.assert_eq('paid',
  (SELECT payment_status FROM sponsorships WHERE id = (SELECT id FROM p)), 'payment_status_row');
SELECT test.assert_eq('paid',
  (SELECT status FROM sponsorships WHERE id = (SELECT id FROM p)), 'sponsorship_status_row');
SELECT test.assert_eq('true',
  (SELECT (paid_at IS NOT NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'paid_at_set');
SELECT test.assert_eq('pi_test_1',
  (SELECT stripe_payment_intent_id FROM sponsorships WHERE id = (SELECT id FROM p)), 'payment_intent_stored');
SELECT test.assert_eq('ch_test_1',
  (SELECT stripe_charge_id FROM sponsorships WHERE id = (SELECT id FROM p)), 'charge_id_stored');
SELECT test.assert_eq('paid',
  (SELECT status FROM bids WHERE id = (SELECT winning_bid_id FROM sponsorships WHERE id = (SELECT id FROM p))),
  'winning_bid_marked_paid');
SELECT test.assert_eq('paid',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'slot_auction_paid');
-- The money itself is untouched by a payment: the split was fixed at close time.
SELECT test.assert_eq('30000',
  (SELECT amount::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'amount_unchanged_by_payment');
SELECT test.assert_eq('3000',
  (SELECT platform_fee::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'fee_unchanged_by_payment');
SELECT test.assert_eq('27000',
  (SELECT creator_amount::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'creator_amount_unchanged_by_payment');

-- A replayed webhook must not double-apply.
SELECT test.assert_eq('true',
  (public.mark_sponsorship_paid((SELECT id FROM p), 'pi_test_1', 'ch_test_1'))->>'idempotent',
  'mark_paid_idempotent');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM sponsorships WHERE slot_id = test.id('slot_id') AND status = 'paid'),
  'still_exactly_one_paid');

-- ------------------------------------------- the fulfillment chain (Phase 6), in order
CREATE TEMP TABLE ship AS
SELECT test.call_as(test.id('brand_a_auth'),
  format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_shipped')) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM ship), 'brand_ships_ok');
SELECT test.assert_eq('paid', (SELECT j->>'from' FROM ship), 'ship_from_paid');
SELECT test.assert_eq('product_shipped', (SELECT j->>'status' FROM ship), 'ship_payload_status');
SELECT test.assert_eq('product_shipped',
  (SELECT status FROM sponsorships WHERE id = (SELECT id FROM p)), 'row_shipped');

-- the brand cannot walk the creator's edges
SELECT test.assert_eq('NOT_CREATOR',
  (test.call_as(test.id('brand_a_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_received')))->>'error',
  'brand_cannot_receive');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_received')))->>'ok',
  'creator_receives_ok');

CREATE TEMP TABLE done AS
SELECT test.call_as(test.id('creator_auth'),
  format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'day_completed')) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM done), 'day_completed_ok');
SELECT test.assert_eq('eligible', (SELECT j->>'payout_status' FROM done), 'payout_eligible_reported');
SELECT test.assert_eq('eligible',
  (SELECT payout_status FROM sponsorships WHERE id = (SELECT id FROM p)), 'payout_eligible_row');
SELECT test.assert_eq('true',
  (SELECT (payout_eligible_at IS NOT NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)),
  'payout_eligible_at_set');
-- Completion is a fulfillment fact, not a money event: the split is untouched.
SELECT test.assert_eq('3000',
  (SELECT platform_fee::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'fee_after_fulfillment');
SELECT test.assert_eq('27000',
  (SELECT creator_amount::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'creator_amount_after_fulfillment');
SELECT test.assert_eq('true',
  (SELECT (creator_amount = amount - platform_fee)::text FROM sponsorships WHERE id = (SELECT id FROM p)),
  'split_still_consistent');

-- a backwards edge is refused, and `completed` is not a client-settable target at all
SELECT test.assert_eq('INVALID_TRANSITION',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'product_received')))->>'error',
  'backwards_transition_rejected');
SELECT test.assert_eq('INVALID_TARGET_STATUS',
  (test.call_as(test.id('brand_a_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'completed')))->>'error',
  'completed_is_not_a_client_target');

-- ---------------------------------------------------------------- payout release
CREATE TEMP TABLE rel AS SELECT public.release_payout((SELECT id FROM p), 'tr_test_1') AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM rel), 'release_payout_ok');
SELECT test.assert_eq('released', (SELECT j->>'payout_status' FROM rel), 'payout_status_reported');
SELECT test.assert_eq('tr_test_1', (SELECT j->>'stripe_transfer_id' FROM rel), 'transfer_id_reported');
SELECT test.assert_eq('released',
  (SELECT payout_status FROM sponsorships WHERE id = (SELECT id FROM p)), 'payout_status_row');
SELECT test.assert_eq('tr_test_1',
  (SELECT stripe_transfer_id FROM sponsorships WHERE id = (SELECT id FROM p)), 'transfer_id_row');
SELECT test.assert_eq('true',
  (SELECT (payout_released_at IS NOT NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)),
  'payout_released_at_set');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM sponsorships WHERE stripe_transfer_id IS NOT NULL), 'one_transfer_only');
SELECT test.assert_eq('true',
  (public.release_payout((SELECT id FROM p), 'tr_test_2'))->>'idempotent', 'release_payout_idempotent');
SELECT test.assert_eq('tr_test_1',
  (SELECT stripe_transfer_id FROM sponsorships WHERE id = (SELECT id FROM p)), 'transfer_id_not_overwritten');

-- ================================================================ review (Phase 7)
CREATE TEMP TABLE rp AS
SELECT test.call_as(test.id('creator_auth'),
  format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p), 'review_pending')) AS j;
SELECT test.assert_eq('true', (SELECT j->>'ok' FROM rp), 'review_pending_ok');
SELECT test.assert_eq('review_pending',
  (SELECT status FROM sponsorships WHERE id = (SELECT id FROM p)), 'row_review_pending');

CREATE TEMP TABLE rev AS
SELECT test.call_as(test.id('creator_auth'),
  format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
         (SELECT id FROM p), 1, 'Not for me', 'It did not fit my workflow',
         ARRAY['none'], ARRAY['slow'], false, NULL, NULL)) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM rev), 'one_star_review_accepted');
SELECT test.assert_eq('1', (SELECT j->>'rating' FROM rev), 'one_star_rating_kept');
SELECT test.assert_eq('true', (SELECT j->>'inserted' FROM rev), 'first_review_is_an_insert');
SELECT test.assert_eq('completed', (SELECT j->>'status' FROM rev), 'completed_after_review');
SELECT test.assert_eq('completed',
  (SELECT status FROM sponsorships WHERE id = (SELECT id FROM p)), 'row_completed');
SELECT test.assert_eq('1',
  (SELECT rating::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'review_row_rating_is_1');
-- The reviewed brand is the WINNING bid's brand (brand A), never the losing bidder (brand B).
SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'review_brand_is_winner');
SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'sponsorship_brand_is_winner');
-- A 1-star review never touches the payout.
SELECT test.assert_eq('3000',
  (SELECT platform_fee::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'fee_unchanged_by_rating');
SELECT test.assert_eq('27000',
  (SELECT creator_amount::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'creator_amount_unchanged_by_rating');
SELECT test.assert_eq('released',
  (SELECT payout_status FROM sponsorships WHERE id = (SELECT id FROM p)), 'payout_unchanged_by_rating');

-- The creator may edit their own review: still exactly one row, and the brand cannot move.
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p), 5, 'Edited', 'Second thoughts', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'ok', 'review_edit_ok');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'still_one_review');
SELECT test.assert_eq('5',
  (SELECT rating::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'review_edited_rating');
SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'review_brand_still_winner');

-- A brand can never submit or rewrite the creator's review.
SELECT test.assert_eq('NOT_CREATOR',
  (test.call_as(test.id('brand_a_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p), 5, 'fake', 'fake', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'brand_cannot_review');

-- B ends here: C needs a fresh transaction, otherwise its BEGIN joins this one and C
-- would inherit the paid slot state that place_bid justly refuses.
ROLLBACK;

-- ============================================================================
-- C. The review gate before review_pending, invalid ratings, and refunds.
-- ============================================================================
BEGIN;

SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 20000) $$))->>'ok', 'c_setup_bid_b');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 30000) $$))->>'ok', 'c_setup_bid_a');
UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');
SELECT test.assert_eq('true', (public.close_expired_auction(test.id('slot_id')))->>'ok', 'c_setup_close');

CREATE TEMP TABLE p2 AS SELECT id FROM sponsorships WHERE slot_id = test.id('slot_id');

-- An unpaid sponsorship cannot be reviewed: the payment gate comes first.
SELECT test.assert_eq('NOT_PAID',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p2), 5, 'too early', 'too early', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'unpaid_review_refused');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p2)), 'no_review_row_created');

-- A refund is impossible before payment succeeded.
SELECT test.assert_eq('NOT_PAID',
  (public.record_refund((SELECT id FROM p2), 're_test_1', 100))->>'error', 'unpaid_refund_refused');

-- Payment lands; fulfillment has not started, so the review is still refused.
SELECT test.assert_eq('true',
  (public.mark_sponsorship_paid((SELECT id FROM p2), 'pi_test_2', 'ch_test_2'))->>'ok', 'c_paid_ok');
SELECT test.assert_eq('NOT_REVIEW_PENDING',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p2), 5, 'too early', 'too early', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'review_before_review_pending_refused');
-- ...and the brand is refused as an author regardless of the stage.
SELECT test.assert_eq('NOT_CREATOR',
  (test.call_as(test.id('brand_a_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p2), 5, 'fake', 'fake', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'brand_cannot_author_review');

-- Walk to the review stage.
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p2), 'product_shipped')))->>'ok',
  'c_ship_ok');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p2), 'product_received')))->>'ok',
  'c_receive_ok');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p2), 'day_completed')))->>'ok',
  'c_day_ok');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.advance_fulfillment(%L, %L)', (SELECT id FROM p2), 'review_pending')))->>'ok',
  'c_review_pending_ok');
-- The rating must be an integer in 1..5; 0 and 6 are refused.
SELECT test.assert_eq('INVALID_RATING',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p2), 0, 'zero', 'zero', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'zero_rating_rejected');
SELECT test.assert_eq('INVALID_RATING',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p2), 6, 'six', 'six', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'six_rating_rejected');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p2)), 'invalid_ratings_record_nothing');

-- ---------------------------------------------------------------- refunds
SELECT test.assert_eq('INVALID_REFUND_AMOUNT',
  (public.record_refund((SELECT id FROM p2), 're_test_1', 0))->>'error', 'zero_refund_rejected');
SELECT test.assert_eq('INVALID_REFUND_AMOUNT',
  (public.record_refund((SELECT id FROM p2), 're_test_1', 999999))->>'error', 'over_refund_rejected');

CREATE TEMP TABLE rr AS SELECT public.record_refund((SELECT id FROM p2), 're_test_1', 5000) AS j;
SELECT test.assert_eq('true', (SELECT j->>'ok' FROM rr), 'refund_ok');
SELECT test.assert_eq('refunded', (SELECT j->>'status' FROM rr), 'refund_status_reported');
SELECT test.assert_eq('refunded', (SELECT j->>'payment_status' FROM rr), 'refund_payment_status_reported');
SELECT test.assert_eq('5000', (SELECT j->>'refund_amount' FROM rr), 'refund_amount_reported');
SELECT test.assert_eq('refunded',
  (SELECT status FROM sponsorships WHERE id = (SELECT id FROM p2)), 'refund_status_row');
SELECT test.assert_eq('5000',
  (SELECT refund_amount::text FROM sponsorships WHERE id = (SELECT id FROM p2)), 'refund_amount_row');
SELECT test.assert_eq('true',
  (SELECT (refunded_at IS NOT NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p2)), 'refunded_at_set');
SELECT test.assert_eq('re_test_1',
  (SELECT stripe_refund_id FROM sponsorships WHERE id = (SELECT id FROM p2)), 'refund_id_stored');
SELECT test.assert_eq('cancelled',
  (SELECT payout_status FROM sponsorships WHERE id = (SELECT id FROM p2)), 'refunded_payout_cancelled');

-- A replayed refund webhook must not double-apply.
SELECT test.assert_eq('true',
  (public.record_refund((SELECT id FROM p2), 're_test_1', 5000))->>'idempotent', 'refund_idempotent');
SELECT test.assert_eq('5000',
  (SELECT refund_amount::text FROM sponsorships WHERE id = (SELECT id FROM p2)), 'refund_not_double_applied');

-- Once refunded, the review gate is closed again (the payment is gone).
SELECT test.assert_eq('NOT_PAID',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p2), 5, 'late', 'late', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'refunded_review_refused');

ROLLBACK;

-- ============================================================================
-- D. An unpaid auction outcome can be neither reviewed, refunded, nor paid out.
-- ============================================================================
BEGIN;

SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 12000) $$))->>'ok', 'd_setup_bid');
UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');
SELECT test.assert_eq('true', (public.close_expired_auction(test.id('slot_id')))->>'ok', 'd_setup_close');

CREATE TEMP TABLE p3 AS SELECT id FROM sponsorships WHERE slot_id = test.id('slot_id');

SELECT test.assert_eq('NOT_PAID',
  (test.call_as(test.id('creator_auth'),
    format('SELECT public.submit_review(%L, %L, %L, %L, %L::text[], %L::text[], %L, %L, %L)',
           (SELECT id FROM p3), 4, 'unpaid', 'unpaid', ARRAY[]::text[], ARRAY[]::text[],
           true, NULL, NULL)))->>'error', 'd_review_refused');
SELECT test.assert_eq('NOT_PAID',
  (public.record_refund((SELECT id FROM p3), 're_test_1', 100))->>'error', 'd_refund_refused');
SELECT test.assert_eq('PAYOUT_NOT_ELIGIBLE',
  (public.release_payout((SELECT id FROM p3), 'tr_test_1'))->>'error', 'd_payout_refused');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p3)), 'd_no_review_row');
SELECT test.assert_eq('pending',
  (SELECT payment_status FROM sponsorships WHERE id = (SELECT id FROM p3)), 'd_payment_still_pending');

ROLLBACK;