#!/usr/bin/env bash
#
# DaySponsor — database & auction-engine test runner (Engineer A).
#
#   bash tests/db/run-tests.sh
#
# What it does
#   1. ensures a throwaway Postgres 15 container is up (postgres:15-alpine)
#   2. creates a FRESH database every run
#   3. applies tests/db/bootstrap.sql (auth shim + test helpers), then every file in
#      supabase/migrations/ in filename order, then tests/db/seed.sql
#   4. runs each tests/db/NN_*.sql suite in its own psql session
#   5. runs the parallel-bid concurrency test (tests/db/concurrency.sh)
#
# The runner adds no dependency to the project: everything goes through `psql` inside
# the container, so package.json / package-lock.json are never touched.
#
# Every environment variable has a default; override to point at another instance:
#   DAYSPONSOR_PG_CONTAINER, DAYSPONSOR_PG_IMAGE, DAYSPONSOR_PG_PORT, DAYSPONSOR_PG_DB
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="${DAYSPONSOR_PG_CONTAINER:-daysponsor-pg}"
IMAGE="${DAYSPONSOR_PG_IMAGE:-postgres:15-alpine}"
HOST_PORT="${DAYSPONSOR_PG_PORT:-54329}"
DB="${DAYSPONSOR_PG_DB:-daysponsor_test}"

PASS=0
FAIL=0
FAILED_SUITES=()

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32mPASS\033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); FAILED_SUITES+=("$*"); }

# ------------------------------------------------------------------ container
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  say "starting $IMAGE as $CONTAINER (port $HOST_PORT)"
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
    -p "${HOST_PORT}:5432" "$IMAGE" >/dev/null
elif [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
  say "starting existing container $CONTAINER"
  docker start "$CONTAINER" >/dev/null
fi

say "waiting for Postgres"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 || {
  echo "Postgres in $CONTAINER never became ready" >&2
  exit 1
}

# psql against the test database. -q keeps the harness output readable; ON_ERROR_STOP
# makes any SQL error a non-zero exit, which is what the suites rely on.
psql_db() {
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q "$@"
}

# ------------------------------------------------------------------ fresh database
say "resetting database $DB"
docker exec "$CONTAINER" psql -U postgres -d postgres -q -c \
  "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
docker exec "$CONTAINER" psql -U postgres -d postgres -q -c \
  "CREATE DATABASE $DB" >/dev/null

# ------------------------------------------------------------------ migrations
say "bootstrap (auth shim + test helpers)"
if psql_db -f - <"$ROOT/tests/db/bootstrap.sql" 2>/tmp/ds_boot.err; then
  ok "bootstrap.sql"
else
  bad "bootstrap.sql"; sed 's/^/      /' /tmp/ds_boot.err
fi

say "applying migrations in filename order"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  name="$(basename "$f")"
  if psql_db -f - <"$f" 2>/tmp/ds_mig.err; then
    ok "migration $name"
  else
    bad "migration $name"; sed 's/^/      /' /tmp/ds_mig.err
  fi
done

say "seed"
if psql_db -f - <"$ROOT/tests/db/seed.sql" >/dev/null 2>/tmp/ds_seed.err; then
  ok "seed.sql"
else
  bad "seed.sql"; sed 's/^/      /' /tmp/ds_seed.err
fi

# ------------------------------------------------------------------ suites
for f in $(ls "$ROOT"/tests/db/[0-9][0-9]_*.sql | sort); do
  name="$(basename "$f")"
  say "suite $name"
  if out="$(psql_db -f - <"$f" 2>&1)"; then
    ok "$name"
  else
    bad "$name"
    printf '%s\n' "$out" | grep -Ei 'error|failed' | head -20 | sed 's/^/      /'
  fi
done

# ------------------------------------------------------------------ concurrency
say "concurrency (parallel bids)"
if out="$(DAYSPONSOR_PG_CONTAINER="$CONTAINER" DAYSPONSOR_PG_DB="$DB" \
          bash "$ROOT/tests/db/concurrency.sh" 2>&1)"; then
  ok "concurrency.sh"
  printf '%s\n' "$out" | sed 's/^/      /'
else
  bad "concurrency.sh"
  printf '%s\n' "$out" | sed 's/^/      /'
fi

# ------------------------------------------------------------------ summary
say "summary"
printf '  passed: %d\n  failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '  failing: %s\n' "${FAILED_SUITES[*]}"
  exit 1
fi
echo "  all database tests passed"