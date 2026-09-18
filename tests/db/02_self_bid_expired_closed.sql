-- ============================================================================
-- Suite 02 — self-bidding, expired auctions, closed / draft / full auctions, and the
-- open_auction authorization + validation surface.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- -------------------------------------------------- opening is idempotent for the owner
-- The seed already opened this auction; re-opening reports the LIVE terms unchanged.
CREATE TEMP TABLE o1 AS
SELECT test.call_as(test.id('creator_auth'),
  $$ SELECT public.open_auction(test.id('slot_id'), 10000, 'eur', now() + INTERVAL '2 hours') $$) AS j;

SELECT test.assert_eq('true', (SELECT j->>'ok' FROM o1), 'reopen_ok');
SELECT test.assert_eq('true', (SELECT j->>'idempotent' FROM o1), 'reopen_idempotent');
SELECT test.assert_eq('5000', (SELECT j->>'starting_price' FROM o1), 'reopen_keeps_live_terms');
SELECT test.assert_eq('open',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'status_open');

-- ------------------------------------------------------ only the Day's creator may open
SELECT test.assert_eq('NOT_SLOT_OWNER',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.open_auction(test.id('slot_id'), 10000, 'eur', now() + INTERVAL '1 hour') $$))->>'error',
  'only_day_owner_opens');

-- ----------------------------------------------------------------- open_auction input
SELECT test.assert_eq('INVALID_STARTING_PRICE',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT public.open_auction(test.id('slot_id'), 0, 'eur', now() + INTERVAL '1 hour') $$))->>'error',
  'zero_starting_price_rejected');
SELECT test.assert_eq('INVALID_END_TIME',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT public.open_auction(test.id('slot_id'), 10000, 'eur', now() - INTERVAL '1 hour') $$))->>'error',
  'past_end_time_rejected');
SELECT test.assert_eq('UNSUPPORTED_CURRENCY',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT public.open_auction(test.id('slot_id'), 10000, 'jpy', now() + INTERVAL '1 hour') $$))->>'error',
  'unsupported_currency_rejected');
SELECT test.assert_eq('UNAUTHENTICATED',
  (test.call_as(NULL,
    $$ SELECT public.open_auction(test.id('slot_id'), 10000, 'eur', now() + INTERVAL '1 hour') $$))->>'error',
  'anonymous_cannot_open');
SELECT test.assert_eq('SLOT_NOT_FOUND',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT public.open_auction('00000000-0000-0000-0000-0000000000ff'::uuid, 10000, 'eur', now() + INTERVAL '1 hour') $$))->>'error',
  'open_unknown_slot_rejected');

-- Nothing above may have moved the auction: still the seeded terms, still no bids.
SELECT test.assert_eq('5000',
  (SELECT starting_price::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'terms_unchanged');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id')), 'no_bids_recorded');
-- ------------------------------------------------------- a brand bidding on its own Day
-- Make brand A the owner of the Day this slot belongs to; place_bid must refuse.
UPDATE days SET creator_id = test.id('brand_a_uid') WHERE id = test.id('day_id');

SELECT test.assert_eq('SELF_BID_FORBIDDEN',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 20000) $$))->>'error', 'self_bid_rejected');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id')), 'self_bid_not_recorded');

UPDATE days SET creator_id = test.id('creator_uid') WHERE id = test.id('day_id');

-- ------------------------------------------------------- the auction has ended by clock
UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');

SELECT test.assert_eq('AUCTION_ENDED',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 20000) $$))->>'error', 'expired_auction_rejected');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id')), 'expired_bid_not_recorded');

-- move the clock back so the closed/full cases below are not masked by AUCTION_ENDED
UPDATE sponsorship_slots SET auction_ends_at = now() + INTERVAL '1 hour'
WHERE id = test.id('slot_id');

-- --------------------------------------------------------------- a closed auction
-- Arranged state: only the owner can flip auction_status (no client path can).
SELECT test.as_owner($$
  UPDATE sponsorship_slots SET auction_status = 'closed', closed_at = now()
  WHERE id = test.id('slot_id') $$);

SELECT test.assert_eq('AUCTION_NOT_OPEN',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 20000) $$))->>'error', 'closed_auction_rejected');
SELECT test.assert_eq('closed',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 20000) $$))->>'auction_status', 'closed_status_reported');

-- ----------------------------------------------------------------- a draft auction
SELECT test.as_owner($$
  UPDATE sponsorship_slots SET auction_status = 'draft', closed_at = NULL
  WHERE id = test.id('slot_id') $$);

SELECT test.assert_eq('AUCTION_NOT_OPEN',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 20000) $$))->>'error', 'draft_auction_rejected');
SELECT test.assert_eq('draft',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 20000) $$))->>'auction_status', 'draft_status_reported');
-- A draft slot is a slot whose auction has not started, so its creator may open it.
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT public.open_auction(test.id('slot_id'), 5000, 'eur', now() + INTERVAL '1 hour') $$))->>'ok',
  'draft_slot_reopens_ok');
SELECT test.assert_eq('open',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'draft_slot_now_open');

ROLLBACK;

-- ============================================================================
-- AUCTION_FULL: an auction that already produced a live sponsorship takes no more bids.
-- ============================================================================
BEGIN;

-- Run a real auction to completion so a live sponsorship exists.
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 6000) $$))->>'ok', 'full_setup_bid');
UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');
SELECT test.assert_eq('true',
  (public.close_expired_auction(test.id('slot_id')))->>'ok', 'full_setup_close');
SELECT test.assert_eq('awaiting_payment',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'full_setup_awaiting');

-- A settled auction cannot be re-opened by its creator.
SELECT test.assert_eq('AUCTION_NOT_DRAFT',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT public.open_auction(test.id('slot_id'), 5000, 'eur', now() + INTERVAL '1 hour') $$))->>'error',
  'settled_auction_not_reopened');

-- Force the slot open again (arranged state) while the live sponsorship still exists.
SELECT test.as_owner($$
  UPDATE sponsorship_slots SET auction_status = 'open', auction_ends_at = now() + INTERVAL '1 hour'
  WHERE id = test.id('slot_id') $$);

SELECT test.assert_eq('AUCTION_FULL',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 7000) $$))->>'error', 'full_auction_rejected');
SELECT test.assert_eq('6000',
  (SELECT amount::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending'),
  'full_auction_winner_unchanged');

-- Closing an auction that has not reached its end time is refused.
SELECT test.assert_eq('AUCTION_NOT_ENDED',
  (public.close_expired_auction(test.id('slot_id')))->>'error', 'close_before_end_rejected');

ROLLBACK;