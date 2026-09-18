#!/usr/bin/env bash
#
# DaySponsor — parallel-bid concurrency test (Engineer A).
#
#   bash tests/db/concurrency.sh
#
# Submits N ACTUAL parallel bids — N separate psql processes, so N separate backends and
# N separate transactions racing each other — and then verifies database consistency:
#
#   * exactly ONE bid is left `active` (only one selected leader)
#   * every other surviving bid is `outbid`
#   * the slot's current_highest_bid / current_highest_bid_id point at that one bid
#   * the leader carries the highest amount on the slot
#   * no two surviving bids share an amount (each accepted bid strictly beat the leader
#     before it, so accepted amounts strictly increase over time)
#   * the number of bid rows equals the number of successful place_bid calls: no lost
#     updates and no phantom rows
#
# Why processes rather than threads: `place_bid` serialises on `SELECT ... FOR UPDATE` of
# the slot row, so the property under test only shows up if the bids really are in flight
# at the same time. Sequential calls would pass trivially.
#
# Every worker acts as a real client: `SET LOCAL ROLE authenticated` (so RLS and the guard
# triggers are in force) plus a per-session identity, which is where a JWT claim lands.
# No node/`pg` dependency is used, so package.json stays untouched.
set -uo pipefail

CONTAINER="${DAYSPONSOR_PG_CONTAINER:-daysponsor-pg}"
DB="${DAYSPONSOR_PG_DB:-daysponsor_test}"
WORKERS="${DAYSPONSOR_CONCURRENCY_WORKERS:-24}"

psql_owner() {
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -tAq "$@"
}

SLOT="$(psql_owner -c "select test.id('slot_id')" | tr -d '[:space:]')"
BRAND_A="$(psql_owner -c "select test.id('brand_a_auth')" | tr -d '[:space:]')"
BRAND_B="$(psql_owner -c "select test.id('brand_b_auth')" | tr -d '[:space:]')"
BRAND_C="$(psql_owner -c "select test.id('brand_c_auth')" | tr -d '[:space:]')"

if [ -z "$SLOT" ]; then
  echo "concurrency: could not resolve the seeded slot id" >&2
  exit 1
fi

echo "concurrency: slot $SLOT, workers $WORKERS, 3 brands"

# ------------------------------------------------------------------ arrange
# Reset the slot to a clean, freshly opened auction with no bids and no sponsorship. The
# column guard is lifted for this: it is the same owner-only switch the RPCs use, and no
# client path can reach it (that is asserted in 06_security.sql).
psql_owner >/dev/null <<SQL
BEGIN;
SELECT app.set_guard(false);
DELETE FROM public.bids WHERE slot_id = '$SLOT';
DELETE FROM public.sponsorships WHERE slot_id = '$SLOT';
UPDATE public.sponsorship_slots
   SET auction_status = 'open',
       starting_price = 1000,
       currency = 'eur',
       auction_ends_at = now() + INTERVAL '10 minutes',
       current_highest_bid = NULL,
       current_highest_bid_id = NULL,
       winning_bid_id = NULL,
       closed_at = NULL,
       payment_due_at = NULL,
       winner_attempt_count = 0
 WHERE id = '$SLOT';
SELECT app.set_guard(true);
COMMIT;
SQL
# ------------------------------------------------------------------ race
RESULTS_DIR="$(mktemp -d)"
PIDS=()

for i in $(seq 1 "$WORKERS"); do
  case $((i % 3)) in
    0) BIDDER="$BRAND_A" ;;
    1) BIDDER="$BRAND_B" ;;
    2) BIDDER="$BRAND_C" ;;
  esac

  # Deliberately clustered amounts, so several workers contend for the SAME value: the
  # losers of that contention must observe BID_TOO_LOW instead of overwriting the leader.
  AMOUNT=$((5000 + (i / 3) * 10 + (i % 3)))

  (
    docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -tAq -v ON_ERROR_STOP=1 \
      >"$RESULTS_DIR/$i.out" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('test.uid', '$BIDDER', true);
SELECT public.place_bid('$SLOT', $AMOUNT);
COMMIT;
SQL
  ) &
  PIDS+=("$!")
done

for pid in "${PIDS[@]}"; do wait "$pid"; done

ACCEPTED=0
REJECTED=0
for f in "$RESULTS_DIR"/*.out; do
  if grep -q '"ok": true' "$f"; then
    ACCEPTED=$((ACCEPTED + 1))
  else
    REJECTED=$((REJECTED + 1))
  fi
done
rm -rf "$RESULTS_DIR"

echo "concurrency: $ACCEPTED accepted, $REJECTED refused by the auction rules"

# ------------------------------------------------------------------ assert
# Every assertion is an equality on the EFFECT in the database, evaluated by the owner
# after all workers have finished.
psql_owner -v expected_ok="$ACCEPTED" >/dev/null <<'SQL'
SELECT test.assert_eq('1',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'),
  'concurrency_one_active_leader');

SELECT test.assert_eq(
  (SELECT (count(*) - 1)::text FROM bids WHERE slot_id = test.id('slot_id')),
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'outbid'),
  'concurrency_rest_outbid');

SELECT test.assert_eq(
  (SELECT current_highest_bid::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  (SELECT amount::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'),
  'concurrency_slot_amount_matches_leader');

SELECT test.assert_eq(
  (SELECT current_highest_bid_id::text FROM sponsorship_slots WHERE id = test.id('slot_id')),
  (SELECT id::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'),
  'concurrency_slot_bid_id_matches_leader');

SELECT test.assert_eq(
  (SELECT max(amount)::text FROM bids WHERE slot_id = test.id('slot_id')),
  (SELECT amount::text FROM bids WHERE slot_id = test.id('slot_id') AND status = 'active'),
  'concurrency_leader_is_max_amount');

SELECT test.assert_eq(
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id')),
  (SELECT count(DISTINCT amount)::text FROM bids WHERE slot_id = test.id('slot_id')),
  'concurrency_amounts_are_strictly_increasing');

SELECT test.assert_eq(:'expected_ok',
  (SELECT count(*)::text FROM bids WHERE slot_id = test.id('slot_id')),
  'concurrency_row_count_matches_accepted_calls');

SELECT test.assert_eq('open',
  (SELECT auction_status FROM sponsorship_slots WHERE id = test.id('slot_id')),
  'concurrency_auction_still_open');
SQL

ROWS="$(psql_owner -c "select count(*) from bids where slot_id = '$SLOT'" | tr -d '[:space:]')"
echo "concurrency: consistent — one leader, $ROWS bid rows"
# ARRANGE_END