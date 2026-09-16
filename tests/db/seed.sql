-- Seed data for the database test suites.
-- One creator with a day, three brands, one open auction slot. Registers the fixed ids
-- the suites address via test.id('<name>').

\set ON_ERROR_STOP on

TRUNCATE auth.users, bids, reviews, sponsorships, sponsorship_slots, days, creator_profiles, profiles, deliverables, stripe_webhook_events, test.ids RESTART IDENTITY CASCADE;

-- users / profiles
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'creator@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'brandA@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'brandB@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'brandC@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'admin@example.com');

INSERT INTO profiles (id, user_id, email, name, username, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'creator@example.com', 'Creator One', '@creator', 'creator'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'brandA@example.com', 'Brand Alpha', '@branda', 'brand'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'brandB@example.com', 'Brand Beta', '@brandb', 'brand'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', 'brandC@example.com', 'Brand Gamma', '@brandc', 'brand'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '55555555-5555-5555-5555-555555555555', 'admin@example.com', 'Admin', '@admin', 'admin');

INSERT INTO creator_profiles (profile_id, occupation, location) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Software Developer', 'Amsterdam');

INSERT INTO days (id, creator_id, title, day_date, location, category, status) VALUES
  ('11111111-2222-3333-4444-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Building in public', CURRENT_DATE + INTERVAL '30 days', 'Amsterdam', 'Developer', 'live');

-- The auction is OPEN in the seeded state, because suite 01 exercises bidding: the very
-- first thing a brand does is place a bid, and place_bid requires an open auction.
-- `starting_price` is 5000 minor units (eur). Suite 01's numbers are built around it: a
-- bid of 5000 meets the floor and is accepted, a bid of 1000 is below it and is refused,
-- and repeating the leader's own amount is refused as "not strictly higher".
--
-- `price` (299) is the legacy fixed price in MAJOR units that the pre-auction checkout UI
-- reads; it is left untouched on purpose (see docs/database-auction-implementation.md).
INSERT INTO sponsorship_slots (
  id, day_id, tier, price, position, is_available,
  starting_price, currency, auction_status, auction_ends_at
) VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-2222-3333-4444-555555555555',
  'Primary', 299, 1, true,
  5000, 'eur', 'open', now() + INTERVAL '1 hour'
);

-- The named id registry the suites resolve with test.id('<name>').
-- NOTE: the `*_auth` names below are the auth.users ids that test.as_user() needs --
-- place_bid()/open_auction() resolve the brand/creator profile FROM the auth uid, so
-- passing a profile id there makes the RPC see nobody and fail UNAUTHENTICATED /
-- BRAND_PROFILE_REQUIRED. They must be registered here, not just as psql variables:
-- :\`var` is client-side text substitution and cannot reach inside test.id('...').
INSERT INTO test.ids (name, value) VALUES
  ('creator_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('brand_a_uid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('brand_b_uid', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('brand_c_uid', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('admin_uid',   'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  ('day_id',      '11111111-2222-3333-4444-555555555555'),
  ('slot_id',     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  -- auth.users ids, for test.as_user(). Distinct from the `*_uid` profile ids.
  ('creator_auth', '11111111-1111-1111-1111-111111111111'),
  ('brand_a_auth', '22222222-2222-2222-2222-222222222222'),
  ('brand_b_auth', '33333333-3333-3333-3333-333333333333'),
  ('brand_c_auth', '44444444-4444-4444-4444-444444444444'),
  ('admin_auth',   '55555555-5555-5555-5555-555555555555');

-- Kept as psql variables for the few statements that run outside a helper.
\set creator_auth '11111111-1111-1111-1111-111111111111'
\set brand_a_auth '22222222-2222-2222-2222-222222222222'
\set brand_b_auth '33333333-3333-3333-3333-333333333333'
\set brand_c_auth '44444444-4444-4444-4444-444444444444'
\set admin_auth   '55555555-5555-5555-5555-555555555555'

SELECT name, value FROM test.ids ORDER BY name;
