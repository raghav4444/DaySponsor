-- ============================================================================
-- Suite 05 — a normal browser client must not be able to:
--   mark itself winner · change the winning bid · close an auction · change the current
--   highest bid · mark payment successful · change amount / fee / creator amount · set
--   Stripe ids · trigger or complete a payout · reassign a review's sponsorship or brand ·
--   insert / update / delete bids · self-award earnings · write the webhook ledger
--
-- Every attack is issued as `authenticated` with a real uid (test.attempt_as), and every
-- attack is checked twice: what the client was told, and — the assertion that matters —
-- what the row looks like afterwards.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------- arrange a settled auction
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 25000) $$))->>'ok', 'arrange_bid_loser');
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT public.place_bid(test.id('slot_id'), 30000) $$))->>'ok', 'arrange_bid_winner');
UPDATE sponsorship_slots SET auction_ends_at = now() - INTERVAL '1 minute'
WHERE id = test.id('slot_id');
SELECT test.assert_eq('true', (public.close_expired_auction(test.id('slot_id')))->>'ok', 'arrange_close');

CREATE TEMP TABLE p AS SELECT id FROM sponsorships WHERE slot_id = test.id('slot_id');
CREATE TEMP TABLE w AS SELECT id FROM bids WHERE slot_id = test.id('slot_id') AND status = 'payment_pending';
-- The attempt_as/call_as bodies below reference p and w, and those bodies run as the
-- unprivileged `authenticated` role. Temp tables belong to this session's owner, so the
-- role needs an explicit (read-only) grant or every body would die on a permission error
-- against the temp table before the RLS policy under test is ever consulted. psql does
-- not interpolate :'vars' inside dollar-quoted strings, which rules out \gset here.
GRANT SELECT ON p, w TO authenticated;



-- ---------------------------------------------------------------- direct bid INSERT
CREATE TEMP TABLE d_insert AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  INSERT INTO bids (slot_id, brand_id, amount, currency, status)
  VALUES (test.id('slot_id'), test.id('brand_b_uid'), 99999, 'eur', 'active') $$) AS msg;

SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_insert), 'bid_insert_refused');
SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND amount = 99999),
  'bid_insert_wrote_nothing');
SELECT test.assert_eq('2',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id')), 'bid_count_unchanged');

-- ---------------------------------------------------------------- direct bid UPDATE / DELETE
CREATE TEMP TABLE d_update AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  UPDATE bids SET amount = 1 WHERE slot_id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM bids WHERE amount = 1), 'bid_update_denied');
SELECT test.assert_eq('30000',
  (SELECT current_highest_bid::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  'highest_unchanged_by_bid_update');

CREATE TEMP TABLE d_delete AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  DELETE FROM bids WHERE slot_id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('2',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id')), 'bid_delete_denied');

-- ------------------------------------------------- mark itself winner / change the winner
CREATE TEMP TABLE d_winner AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  UPDATE sponsorship_slots
     SET winning_bid_id = (SELECT id FROM bids WHERE slot_id = test.id('slot_id') AND amount = 25000)
   WHERE id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq((SELECT id::text FROM w),
  (SELECT winning_bid_id::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  'winner_unchanged');
SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM sponsorships WHERE slot_id = test.id('slot_id')), 'sponsorship_brand_unchanged');

-- ----------------------------------------------------- change the current highest bid
CREATE TEMP TABLE d_highest AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  UPDATE sponsorship_slots SET current_highest_bid = 1, current_highest_bid_id = NULL
   WHERE id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('30000',
  (SELECT current_highest_bid::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  'current_highest_unchanged');
SELECT test.assert_eq((SELECT id::text FROM w),
  (SELECT current_highest_bid_id::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  'current_highest_bid_id_unchanged');

-- ---------------------------------------------------------------- close the auction
CREATE TEMP TABLE d_close AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  UPDATE sponsorship_slots SET auction_status = 'completed', closed_at = now()
   WHERE id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('awaiting_payment',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')), 'auction_status_unchanged');
-- NOTE: this denial is RLS-silent — the slot UPDATE policy admits only the day's creator,
-- so brand B's statement matches zero rows and succeeds vacuously. The unchanged row above
-- is the protection; there is deliberately no error-message assertion here.

-- --------------------------------------------------------------- change the start price
CREATE TEMP TABLE d_price AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  UPDATE sponsorship_slots SET starting_price = 1, currency = 'gbp' WHERE id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('5000',
  (SELECT starting_price::text FROM sponsorship_slots WHERE id = test.id('slot_id')), 'starting_price_unchanged');
SELECT test.assert_eq('eur',
  (SELECT currency FROM sponsorship_slots WHERE id = test.id('slot_id')), 'slot_currency_unchanged');
-- ---------------------------------------------------- mark the payment successful
-- Brand A IS a party to this sponsorship, so RLS admits the row and it is the COLUMN GUARD
-- (a BEFORE UPDATE trigger) that refuses the write. Both layers get exercised.
CREATE TEMP TABLE d_paid AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  UPDATE sponsorships SET payment_status = 'paid', status = 'paid', paid_at = now()
   WHERE slot_id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_paid), 'client_paid_write_refused');
SELECT test.assert_eq('pending',
  (SELECT payment_status FROM sponsorships WHERE id = (SELECT id FROM p)), 'payment_status_unchanged');
SELECT test.assert_eq('payment_pending',
  (SELECT status FROM sponsorships WHERE id = (SELECT id FROM p)), 'sponsorship_status_unchanged');
SELECT test.assert_eq('true',
  (SELECT (paid_at IS NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'paid_at_still_null');

-- ------------------------------------- change amount / platform fee / creator cut
CREATE TEMP TABLE d_amount AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  UPDATE sponsorships SET amount = 1, platform_fee = 0, creator_amount = 1
   WHERE slot_id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_amount), 'client_amount_write_refused');
SELECT test.assert_eq('30000',
  (SELECT amount::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'amount_unchanged');
SELECT test.assert_eq('3000',
  (SELECT platform_fee::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'fee_unchanged');
SELECT test.assert_eq('27000',
  (SELECT creator_amount::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'creator_amount_unchanged');
SELECT test.assert_eq('true',
  (SELECT (creator_amount = amount - platform_fee)::text FROM sponsorships WHERE id = (SELECT id FROM p)),
  'split_invariant_holds');

-- ------------------------------------------------------------------ set Stripe ids
CREATE TEMP TABLE d_stripe AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  UPDATE sponsorships
     SET stripe_charge_id = 'ch_evil', stripe_transfer_id = 'tr_evil',
         stripe_refund_id = 're_evil', stripe_payment_intent_id = 'pi_evil'
   WHERE slot_id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('true',
  (SELECT (stripe_charge_id IS NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'no_client_charge_id');
SELECT test.assert_eq('true',
  (SELECT (stripe_transfer_id IS NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'no_client_transfer_id');
SELECT test.assert_eq('true',
  (SELECT (stripe_refund_id IS NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'no_client_refund_id');
SELECT test.assert_eq('true',
  (SELECT (stripe_payment_intent_id IS NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'no_client_payment_intent');
SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_stripe), 'client_stripe_write_refused');

-- ------------------------------------------------- trigger and complete a payout
CREATE TEMP TABLE d_payout AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  UPDATE sponsorships SET payout_status = 'eligible', payout_eligible_at = now()
   WHERE slot_id = test.id('slot_id') $$) AS msg;

CREATE TEMP TABLE d_payout_done AS SELECT test.attempt_as(test.id('creator_auth'), $$
  UPDATE sponsorships SET payout_status = 'released', payout_released_at = now()
   WHERE slot_id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('pending',
  (SELECT payout_status FROM sponsorships WHERE id = (SELECT id FROM p)), 'payout_status_unchanged');
SELECT test.assert_eq('true',
  (SELECT (payout_released_at IS NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'no_payout_released_at');
SELECT test.assert_eq('true',
  (SELECT (payout_eligible_at IS NULL)::text FROM sponsorships WHERE id = (SELECT id FROM p)), 'no_eligibility_by_client');

-- --------------------------------------------------------------------- review security
-- Setup: pay, fulfil, and publish the creator's review through the RPCs (the only
-- legitimate edges). mark_sponsorship_paid is the webhook edge and does no auth check,
-- so it is invoked here exactly as the Stripe handler would.
SELECT test.assert_eq('true',
  (public.mark_sponsorship_paid((SELECT id FROM p), 'pi_ok', 'ch_ok'))->>'ok', 'arrange_pay');
-- Fulfilment edges: the BRAND ships; the CREATOR receives and completes the day; then the
-- creator opens the review stage. Each is derived from auth.uid() inside the RPC.
SELECT test.assert_eq('true',
  (test.call_as(test.id('brand_a_auth'), $$ SELECT public.advance_fulfillment((SELECT id FROM p), 'product_shipped') $$))->>'ok', 'arrange_ship');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'), $$ SELECT public.advance_fulfillment((SELECT id FROM p), 'product_received') $$))->>'ok', 'arrange_receive');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'), $$ SELECT public.advance_fulfillment((SELECT id FROM p), 'day_completed') $$))->>'ok', 'arrange_day');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'), $$ SELECT public.advance_fulfillment((SELECT id FROM p), 'review_pending') $$))->>'ok', 'arrange_review_stage');
SELECT test.assert_eq('true',
  (test.call_as(test.id('creator_auth'), $$ SELECT public.submit_review((SELECT id FROM p), 5, 't', 'c', NULL, NULL, true, NULL, NULL) $$))->>'ok', 'arrange_review');

-- A brand — winning or losing — cannot insert a review row.
CREATE TEMP TABLE d_rev_ins AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  INSERT INTO reviews (sponsorship_id, rating, title, content, brand_id)
  VALUES ((SELECT id FROM p), 5, 'x', 'x', test.id('brand_a_uid')) $$) AS msg;

CREATE TEMP TABLE d_rev_ins_loser AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  INSERT INTO reviews (sponsorship_id, rating, title, content, brand_id)
  VALUES ((SELECT id FROM p), 1, 'x', 'x', test.id('brand_b_uid')) $$) AS msg;

SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'brand_cannot_insert_review');
SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_rev_ins), 'winner_brand_insert_refused');
SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_rev_ins_loser), 'loser_brand_insert_refused');

-- No brand may rewrite the creator's review. Not even the reviewed one.
CREATE TEMP TABLE d_rev_upd AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  UPDATE reviews SET rating = 1, content = 'hacked' WHERE sponsorship_id = (SELECT id FROM p) $$) AS msg;

CREATE TEMP TABLE d_rev_upd_loser AS SELECT test.attempt_as(test.id('brand_b_auth'), $$
  UPDATE reviews SET content = 'slander' WHERE sponsorship_id = (SELECT id FROM p) $$) AS msg;

SELECT test.assert_eq('5',
  (SELECT rating::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'brand_cannot_rewrite_review');
SELECT test.assert_eq('c',
  (SELECT content FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'brand_cannot_rewrite_content');
-- Again RLS-silent: the reviews UPDATE policy admits only the day's creator.

-- A review's sponsorship and brand are immovable — even for the creator. The RLS policy
-- lets the creator through (they own the day); the column guard trigger stops the re-point.
CREATE TEMP TABLE d_rev_repoint AS SELECT test.attempt_as(test.id('creator_auth'), $$
  UPDATE reviews SET brand_id = test.id('brand_b_uid')
  WHERE sponsorship_id = (SELECT id FROM p) $$) AS msg;

SELECT test.assert_eq(test.id('brand_a_uid')::text,
  (SELECT brand_id::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'review_brand_immovable');
SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_rev_repoint), 'review_brand_repoint_refused');

CREATE TEMP TABLE d_rev_reslot AS SELECT test.attempt_as(test.id('creator_auth'), $$
  UPDATE reviews SET sponsorship_id = '00000000-0000-0000-0000-000000000099'
  WHERE sponsorship_id = (SELECT id FROM p) $$) AS msg;

SELECT test.assert_eq((SELECT id::text FROM p),
  (SELECT sponsorship_id::text FROM reviews WHERE rating = 5 AND title = 't'), 'review_sponsorship_immovable');
SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_rev_reslot), 'review_sponsorship_repoint_refused');

-- A brand cannot DELETE the review either.
CREATE TEMP TABLE d_rev_del AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  DELETE FROM reviews WHERE sponsorship_id = (SELECT id FROM p) $$) AS msg;

SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM reviews WHERE sponsorship_id = (SELECT id FROM p)), 'brand_cannot_delete_review');

-- ---------------------------------------------------------------- webhook event ledger
-- stripe_webhook_events has no RLS policy at all: deny everything for browsers. The
-- service role (BYPASSRLS) is the only writer — that is the webhook's edge.
CREATE TEMP TABLE d_ledger_ins AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  INSERT INTO stripe_webhook_events (stripe_event_id, event_type, payload)
  VALUES ('evt_forged', 'checkout.session.completed', '{}'::jsonb) $$) AS msg;

CREATE TEMP TABLE d_ledger_upd AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  UPDATE stripe_webhook_events SET processed_at = now() $$) AS msg;

CREATE TEMP TABLE d_ledger_del AS SELECT test.attempt_as(test.id('brand_a_auth'), $$
  DELETE FROM stripe_webhook_events $$) AS msg;

SELECT test.assert_eq('0',
  (SELECT count(*)::text FROM stripe_webhook_events), 'ledger_unwritable_by_clients');
-- The INSERT raises (no INSERT policy for the role). UPDATE and DELETE are RLS-silent:
-- no policy means no visible rows, so both statements match zero rows and succeed
-- vacuously — the count assertion above is the proof nothing was written or destroyed.
SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_ledger_ins), 'ledger_insert_refused');

-- -------------------------------------------------------------- bid privacy (SELECT)
-- bids_select_owner_or_creator admits only owned rows: a brand sees its OWN bids, and
-- the slot's creator sees all bids on their day. The leading ask is public through the
-- `auction_leader` view (amount/currency/created_at only — never brand_id, because RLS
-- is row-level and admitting the leader's row would leak its brand_id). Three proofs:
-- rival sees zero rows of Brand A on the base table; the rival's OWN row is readable;
-- the view exposes the 30000 ask with no brand_id column at all.
SELECT test.assert_eq('0',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT to_jsonb(count(*)) FROM bids WHERE brand_id = test.id('brand_a_uid') $$))::text,
  'loser_cannot_read_winner_bid_rows');
SELECT test.assert_eq('1',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT to_jsonb(count(*)) FROM bids WHERE brand_id = test.id('brand_b_uid') $$))::text,
  'loser_reads_own_bid_rows');
SELECT test.assert_eq('30000',
  (test.call_as(test.id('brand_b_auth'),
    $$ SELECT to_jsonb(amount) FROM public.auction_leader
       WHERE slot_id = test.id('slot_id') $$))::text,
  'leader_ask_public_through_view');
SELECT test.assert_eq('false',
  (SELECT EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'auction_leader'
       AND column_name = 'brand_id'))::text,
  'leader_view_has_no_brand_id_column');
SELECT test.assert_eq('1',
  (test.call_as(test.id('brand_a_auth'),
    $$ SELECT to_jsonb(count(*)) FROM bids WHERE brand_id = test.id('brand_a_uid') $$))::text,
  'winner_reads_own_bid_rows');
SELECT test.assert_eq('2',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT to_jsonb(count(*)) FROM bids WHERE slot_id = test.id('slot_id') $$))::text,
  'creator_reads_all_bids_on_own_day');

-- ------------------------------------------------------------- guard-GUC regression
-- Migration 0007: the column guard used to be keyed on a session GUC, which any client
-- could switch off. It is now keyed by txid in a table only app.set_guard may write.
-- A client flipping the old GUC must be able to (custom GUCs are freely settable) — and
-- it must change nothing. The creator's slot row IS admitted by the UPDATE policy, so the
-- guard trigger is what answers here: the guarded write must still die.
SELECT test.assert_eq('"off"',
  (test.call_as(test.id('creator_auth'),
    $$ SELECT to_jsonb(set_config('app.guard_enabled', 'off', true)) $$))::text,
  'client_can_flip_the_legacy_guc');

CREATE TEMP TABLE d_guc_bypass AS SELECT test.attempt_as(test.id('creator_auth'), $$
  UPDATE sponsorship_slots SET current_highest_bid = 1
  WHERE id = test.id('slot_id') $$) AS msg;

SELECT test.assert_eq('30000',
  (SELECT current_highest_bid::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  'guc_flip_changes_nothing');
SELECT test.assert_eq('true', (SELECT (msg IS NOT NULL)::text FROM d_guc_bypass), 'guc_bypass_write_refused');

ROLLBACK;
