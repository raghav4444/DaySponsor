-- ============================================================================
-- Suite 03 — auction closing (Phase 4): one winner, losers outbid, deterministic
-- tie-breaking, exact fee split, no-bid auctions, idempotency.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ------------------------------------------------------- close before the end time
SELECT test.assert_eq('AUCTION_NOT_ENDED',
  (public.close_expired_auction(test.id('slot_id')))->>'error', 'close_before_end_rejected');

-- --------------------------------------------------------------- four real bids
-- Strictly increasing, as place_bid requires. The final leader is brand A at 30000, and
-- three earlier bids are left behind to be marked outbid by the close.
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 12000) $$))->>'ok', 'bid_a_12000');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 15000) $$))->>'ok', 'bid_b_15000');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 28000) $$))->>'ok', 'bid_b_28000');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 30000) $$))->>'ok', 'bid_a_30000');

-- Let the auction expire.
UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');

-- ------------------------------------------------------------------------ close it
CREATE TEMP TABLE c1 AS SELECT public.close_expired_auction(test.id('slot_id')) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM c1), 'close_ok');
SELECT test.assert_eq('true', (SELECT ((j->>'error') IS NULL)::text FROM c1), 'close_no_error');
SELECT test.assert_eq('awaiting_payment', (SELECT j->>'auction_status' FROM c1), 'close_payload_status');
SELECT test.assert_eq('30000', (SELECT j->>'amount' FROM c1), 'close_payload_amount');
SELECT test.assert_eq('3000', (SELECT j->>'platform_fee' FROM c1), 'close_payload_fee');
SELECT test.assert_eq('27000', (SELECT j->>'creator_amount' FROM c1), 'close_payload_creator_amount');
SELECT test.assert_eq('eur', (SELECT j->>'currency' FROM c1), 'close_payload_currency');
SELECT test.assert_eq('pending', (SELECT j->>'payment_status' FROM c1), 'close_payload_payment_status');
SELECT test.assert_eq('true', (SELECT ((j->>'payment_due_at') IS NOT NULL)::text FROM c1), 'close_sets_deadline');
SELECT test.assert_eq((SELECT j->>'sponsorship_id' FROM c1),
  (SELECT id::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'payload_sponsorship_matches_row');

SELECT test.assert_eq('awaiting_payment',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'slot_awaiting_payment');
SELECT test.assert_eq('true',
  (SELECT (closed_at IS NOT NULL)::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'slot_closed_at_set');
SELECT test.assert_eq('0',
  (SELECT winner_attempt_count::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'no_fallbacks_yet');

-- ------------------------------------------------------------- exactly one winner
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending'), 'one_payment_pending');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'), 'no_active_left');
SELECT test.assert_eq('3',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'outbid'), 'three_outbid');
SELECT test.assert_eq('30000',
  (SELECT amount::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending'), 'winner_is_top_amount');
SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending'), 'winner_is_brand_a');
SELECT test.assert_eq('30000',
  (SELECT current_highest_bid::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'highest_bid_kept');
-- ------------------------------------------------- exactly one sponsorship per slot
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'one_sponsorship');
SELECT test.assert_eq('30000',
  (SELECT amount::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'amount_from_winning_bid');
SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'sponsorship_brand_is_winner');
SELECT test.assert_eq(test.id('creator_uid')::text,
  (SELECT creator_id::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'sponsorship_creator_is_day_owner');
SELECT test.assert_eq('payment_pending',
  (SELECT status FROM sponsorships WHERE slot_id = test.id('slot_id')), 'sponsorship_payment_pending');
SELECT test.assert_eq('pending',
  (SELECT payment_status FROM sponsorships WHERE slot_id = test.id('slot_id')), 'sponsorship_payment_status_pending');

-- ------------------------------------------------------ the 10% / 90% split, in integers
-- floor((30000 * 10 + 50) / 100) = 3000 ; creator = 30000 - 3000 = 27000
SELECT test.assert_eq('3000',
  (SELECT platform_fee::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'fee_is_3000');
SELECT test.assert_eq('27000',
  (SELECT creator_amount::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'creator_amount_is_27000');
SELECT test.assert_eq('true',
  (SELECT (creator_amount = amount - platform_fee)::text FROM sponsorships WHERE slot_id = test.id('slot_id')),
  'split_is_consistent');

-- --------------------------------------------------------- the winning bid is pinned
SELECT test.assert_eq('true',
  (SELECT (winning_bid_id IS NOT NULL)::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'winning_bid_set');
SELECT test.assert_eq(
  (SELECT winning_bid_id::text FROM sponsorships WHERE slot_id = test.id('slot_id')),
  (SELECT winning_bid_id::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'slot_and_sponsorship_agree');
SELECT test.assert_eq(
  (SELECT brand_id::text FROM bids WHERE id = (SELECT winning_bid_id FROM sponsorships WHERE slot_id = test.id('slot_id'))),
  test.id('brand_a_uid')::text, 'winning_bid_brand_matches_sponsorship_brand');

-- ------------------------------------------------------------- idempotent re-close
CREATE TEMP TABLE c2 AS SELECT public.close_expired_auction(test.id('slot_id')) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM c2), 'reclose_ok');
SELECT test.assert_eq('true', (SELECT j->>'idempotent' FROM c2), 'reclose_flagged_idempotent');
SELECT test.assert_eq((SELECT j->>'sponsorship_id' FROM c1), (SELECT j->>'sponsorship_id' FROM c2),
  'reclose_returns_same_sponsorship');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'still_one_sponsorship');
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending'),
  'still_one_payment_pending');
SELECT test.assert_eq('3000',
  (SELECT platform_fee::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'fee_not_double_applied');

-- ------------------------------------------------ a closed auction accepts no more bids
SELECT test.assert_eq('AUCTION_NOT_OPEN',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 99000) $$))->>'error', 'no_bids_after_close');

ROLLBACK;

-- ============================================================================
-- No-bid auction: closes cleanly, creates no sponsorship, and still reports why.
-- ============================================================================
BEGIN;

UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');

CREATE TEMP TABLE c3 AS SELECT public.close_expired_auction(test.id('slot_id')) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM c3), 'no_bid_close_ok');
SELECT test.assert_eq('closed', (SELECT j->>'auction_status' FROM c3), 'no_bid_auction_closed');
SELECT test.assert_eq('no_bids', (SELECT j->>'reason' FROM c3), 'no_bid_reason');
SELECT test.assert_eq('true', (SELECT ((j->>'sponsorship_id') IS NULL)::text FROM c3), 'no_bid_no_sponsorship_key');
SELECT test.assert_eq('closed',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'no_bid_slot_status');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'no_bid_zero_sponsorships');
SELECT test.assert_eq('true',
  (SELECT (payment_due_at IS NULL)::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'no_bid_no_deadline');

ROLLBACK;

-- ============================================================================
-- Deterministic tie-breaking (Phase 4, step 5): equal amounts are ordered by
-- created_at ASC and then by id ASC, so a close is reproducible rather than "whichever
-- row the planner returned first".
--
-- The competing bids are inserted directly as the table owner: this is an ARRANGED state
-- that place_bid cannot produce (it refuses anything not strictly higher), and it is what
-- the ordering rule exists for — rows written by an earlier attempt, a repair, or a
-- replay. Rows are given fixed ids so the id tie-break is assertable.
-- ============================================================================
BEGIN;

INSERT INTO bids (id, slot_id, brand_id, amount, currency, status, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', test.id('slot_id'), test.id('brand_c_uid'),
   40000, 'eur', 'active', now() - INTERVAL '2 minutes'),
  ('00000000-0000-0000-0000-0000000000a2', test.id('slot_id'), test.id('brand_a_uid'),
   40000, 'eur', 'active', now() - INTERVAL '1 minute');

UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');

SELECT test.assert_eq('true', (public.close_expired_auction(test.id('slot_id')))->>'ok', 'tiebreak_closed');
SELECT test.assert_eq(test.id('brand_c_uid')::text,
  (SELECT brand_id::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending'),
  'earliest_created_at_wins');
SELECT test.assert_eq('00000000-0000-0000-0000-0000000000a1',
  (SELECT winning_bid_id::text FROM sponsorships WHERE slot_id = test.id('slot_id')),
  'tiebreak_winner_is_earliest_row');

ROLLBACK;

BEGIN;

-- Same amount AND same created_at: the id is the final tie-breaker.
INSERT INTO bids (id, slot_id, brand_id, amount, currency, status, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000b9', test.id('slot_id'), test.id('brand_b_uid'),
   40000, 'eur', 'active', now() - INTERVAL '1 minute'),
  ('00000000-0000-0000-0000-0000000000b1', test.id('slot_id'), test.id('brand_a_uid'),
   40000, 'eur', 'active', now() - INTERVAL '1 minute');

UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');

SELECT test.assert_eq('true', (public.close_expired_auction(test.id('slot_id')))->>'ok', 'id_tiebreak_closed');
SELECT test.assert_eq('00000000-0000-0000-0000-0000000000b1',
  (SELECT winning_bid_id::text FROM sponsorships WHERE slot_id = test.id('slot_id')),
  'lowest_id_wins_the_final_tiebreak');
SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'id_tiebreak_brand');

ROLLBACK;