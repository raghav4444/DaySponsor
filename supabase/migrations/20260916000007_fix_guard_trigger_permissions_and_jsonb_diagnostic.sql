/*
# DaySponsor — column guard: privilege anchor and trigger permission fix (Phase 8b)

A forward migration. Migration 0003 defined the guard; this one repairs three defects
in it. 0003 itself is not modified, because it is already deployed.

## 1. The guard triggers could not read the guard (functional break)

`tg_sponsorships_client_writable`, `tg_slots_client_writable`,
`tg_creator_profiles_client_writable` and `tg_reviews_client_writable` were declared
plain `LANGUAGE plpgsql`, which means SECURITY INVOKER. They therefore executed as the
*client*, and migration 0003 revokes USAGE on schema `app` and EXECUTE on
`app.guard_enabled()` from anon and authenticated. Every client UPDATE against a
guarded table died with

    ERROR:  permission denied for schema app
    CONTEXT: PL/pgSQL function tg_slots_client_writable() line 11 at IF

before the guard got to make any decision at all. A creator could not even update a
slot `description`. The protection was effectively inverted: every legitimate client
write failed, and that failure masked defect (2).

This migration marks all four trigger functions SECURITY DEFINER with
`SET search_path = public, public`. That is safe *because the four functions perform no
writes*: each either returns NEW or raises. They read one boolean and compare two row
images, so the elevated context buys an attacker nothing. RLS is not affected — a
SECURITY DEFINER trigger does not change the role the *statement* runs as, so "who may
touch the row" is still decided by the policies in 0003.

## 2. The GUC was never a trust anchor (silent bypass, latent until now)

Migration 0003's header asserts that a client session "can neither SET the custom GUC
directly (it is never granted) nor call this function." That is not how Postgres
works: there is no GRANT/REVOKE on the *value* of a custom GUC. Every custom variable
behaves as if PGC_USERSET, so any authenticated session can simply do

    SET LOCAL app.guard_enabled = 'off';

Verified against this build as `authenticated`: the SET returned SET, and
`current_setting('app.guard_enabled', true)` returned `off`. A fresh session shows no
`app.*` row in pg_settings at all until it sets one — there is nothing to protect.

Defects (1) and (2) happened to mask each other: the trigger died on the schema grant
before it could read the flipped switch, so the bypass was not reachable end to end.
Fixing (1) without fixing (2) would have *made* it reachable. They must ship together.

The trust anchor therefore moves off the GUC entirely, onto the one kind of object
Postgres can actually gate with a privilege: a table in schema `app`, which 0003
already revokes USAGE on from anon and authenticated. `app.set_guard(boolean)` and
`app.guard_enabled()` keep their signatures and their SECURITY DEFINER / revoked-from-
clients status, and they remain the only readers and writers of that table. Migrations
0004, 0005 and 0006 therefore keep working unmodified: they all call
`PERFORM app.set_guard(false)` before their guarded writes, `PERFORM app.set_guard(true)`
before returning, and `PERFORM app.set_guard(true); RAISE;` in their exception handlers.

State is keyed by `txid_current()`. That reproduces the one property of `SET LOCAL`
that mattered here and drops the one that did not:

  - The key is transaction-local. A later transaction cannot see an earlier one's row,
    so a guard left OFF by a buggy or aborted RPC cannot leak past the transaction
    boundary. A plain single-row state table would have left the column mask OFF
    database-wide after one forgotten restore.
  - Unlike `SET LOCAL`, nothing reverts by itself on *commit*, so the explicit restore
    stays mandatory — which every RPC already guarantees. A transaction that aborts
    rolls its row back along with everything else, so the guard is ON for the next one.

`guard_enabled()` no longer consults the GUC at all. A client may still type
`SET LOCAL app.guard_enabled = 'off';` — it is inert now, and it is left that way
deliberately rather than "revoked", because there is nothing to revoke.

## 3. `jsonb - jsonb` does not exist (wrong SQLSTATE, unreadable diagnostic)

The changed-column *test* in the three guarded triggers already used the operators that
do exist (`jsonb - text[]` to strip the allowed keys, `jsonb != jsonb` to compare what
was left). The *diagnostic* inside the RAISE did not: it used `v_new - v_old`, which is
the `jsonb - jsonb` operator removed in Postgres 13. A client touching a forbidden
column therefore raised SQLSTATE 42883 (undefined_function) instead of the documented
23514 (check_violation), and the column list never reached the message at all. The write
was still rejected — the guard fails closed — but any client catching
`check_violation` to render "you may not do that" never saw it.

The diff is now computed once, by `public.v_changed_columns(p_old, p_new, p_allowed)`,
built only from `jsonb_object_keys`, `->` and `IS DISTINCT FROM`. It returns the sorted
list of offending column names, so all three diagnostics are now identical in shape and
the subtraction pitfall cannot recur — no trigger writes a jsonb subtraction anymore.

## Not changed by this migration

  - Not one RLS policy. 0003 owns "who may touch the row"; that is untouched.
  - `FORCE ROW LEVEL SECURITY` is still not set on any table. The RPCs are SECURITY
    DEFINER and run as the table owner; FORCE would deny them the writes they exist to
    make.
  - The guard's polarity: ON by default, fail-closed, lifted only inside a
    SECURITY DEFINER function that no client role can call.
*/

-- ============= THE NEW TRUST ANCHOR =============
-- Schema `app` already has USAGE revoked from PUBLIC, anon and authenticated by
-- migration 0003, so no client role can so much as resolve this table's name, let
-- alone read or write it. Only the two SECURITY DEFINER functions below touch it.
CREATE TABLE IF NOT EXISTS app.guard_lifted_for_tx (
  txid        bigint      PRIMARY KEY,
  lifted_at   timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE app.guard_lifted_for_tx FROM PUBLIC, anon, authenticated;

-- ============= THE SWITCH (signature unchanged) =============
-- Still the only way to lift the column guard. Still SECURITY DEFINER, still owned by
-- postgres, still EXECUTE-revoked from PUBLIC, anon and authenticated below — so a
-- client role cannot call it, exactly as 0003 intended. Only the storage moved.
CREATE OR REPLACE FUNCTION app.set_guard(p_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
BEGIN
  IF p_on THEN
    -- Restore. Deleting the current transaction's row re-arms the column guard for
    -- every statement after this one in the same transaction.
    DELETE FROM app.guard_lifted_for_tx WHERE txid = txid_current();

    -- Opportunistic garbage collection. Rows only accumulate when an RPC commits
    -- without restoring, which the current RPCs never do; this bounds the table anyway.
    -- The current transaction is excluded by the txid predicate, and txid_status()
    -- tells us definitively which older transactions are finished, so an in-flight
    -- transaction is never touched. Should a very long-running transaction somehow be
    -- pruned by the hour bound below, the effect is fail-closed: its next guarded
    -- write is rejected instead of silently allowed.
    DELETE FROM app.guard_lifted_for_tx g
    WHERE g.txid <> txid_current()
      AND g.lifted_at < now() - INTERVAL '1 hour'
      AND txid_status(g.txid) IS DISTINCT FROM 'in progress';
  ELSE
    -- Lift, transaction-local. A concurrent transaction has a different txid and so
    -- still sees the guard fully armed.
    INSERT INTO app.guard_lifted_for_tx (txid) VALUES (txid_current())
    ON CONFLICT (txid) DO NOTHING;
  END IF;
END;
$$;

-- ============= THE READER (signature unchanged) =============
-- The guard is ON unless the running transaction has explicitly lifted it. Note what
-- this no longer contains: any reference to the `app.guard_enabled` GUC. That setting
-- is client-writable and carries no privilege boundary, so it is not consulted.
CREATE OR REPLACE FUNCTION app.guard_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM app.guard_lifted_for_tx g WHERE g.txid = txid_current()
  )
$$;

REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.guard_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.set_guard(boolean) FROM PUBLIC, anon, authenticated;

-- ============= THE SHARED COLUMN DIFF (replaces the jsonb subtraction) =============
-- Returns the sorted names of the columns that differ and are not in the allow list.
-- Uses only `jsonb_object_keys`, `->` and `IS DISTINCT FROM`; deliberately no `-`
-- operator anywhere, because `jsonb - jsonb` does not exist in Postgres 13+ and using
-- it silently turns a check_violation into an undefined_function.
--
-- Equivalent to the old "strip the allowed keys from both images and compare" test:
-- OLD and NEW are rows of the same table, so jsonb_object_keys yields the same column
-- set for both, and a column that is not allowed must then be value-equal in both.
CREATE OR REPLACE FUNCTION public.v_changed_columns(
  p_old jsonb,
  p_new jsonb,
  p_allowed text[]
)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, public
AS $$
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
  FROM jsonb_object_keys(p_new) AS k
  WHERE NOT (k = ANY (p_allowed))
    AND (p_new -> k) IS DISTINCT FROM (p_old -> k)
$$;

REVOKE ALL ON FUNCTION public.v_changed_columns(jsonb, jsonb, text[]) FROM PUBLIC, anon;

-- ============= SPONSORSHIPS =============
CREATE OR REPLACE FUNCTION public.tg_sponsorships_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_allowed text[] := ARRAY['status', 'updated_at'];
  v_changed text[];
BEGIN
  -- SECURITY DEFINER so the trigger can consult the guard at all: as SECURITY INVOKER
  -- it ran as the client and hit `permission denied for schema app` on every call.
  -- Safe because this function never writes; it returns NEW or raises.
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;   -- trusted service-role write; only RPCs reaching this point can be here
  END IF;

  v_changed := public.v_changed_columns(to_jsonb(OLD), to_jsonb(NEW), v_allowed);

  IF cardinality(v_changed) > 0 THEN
    RAISE EXCEPTION
      'sponsorship %: client may only set status (and updated_at); other columns changed: %',
      NEW.id, array_to_string(v_changed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.sponsorships_status_transition_ok(OLD.status, NEW.status) THEN
    RAISE EXCEPTION
      'sponsorship %: illegal status transition % -> %',
      NEW.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sponsorships_client_writable ON sponsorships;
CREATE TRIGGER trg_sponsorships_client_writable
  BEFORE UPDATE ON sponsorships
  FOR EACH ROW EXECUTE FUNCTION public.tg_sponsorships_client_writable();

-- ============= SPONSORSHIP SLOTS =============
CREATE OR REPLACE FUNCTION public.tg_slots_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'id', 'day_id', 'created_at', 'updated_at',
    'tier', 'price', 'position', 'description', 'is_available',
    'starting_price', 'currency', 'auction_ends_at'
  ];
  v_changed text[];
BEGIN
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_changed := public.v_changed_columns(to_jsonb(OLD), to_jsonb(NEW), v_allowed);

  IF cardinality(v_changed) > 0 THEN
    RAISE EXCEPTION
      'slot %: client may not change auction settlement columns: %',
      NEW.id, array_to_string(v_changed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  -- a client may not flip the auction status at all; open_auction / close_expired_auction
  -- / expire_unpaid_winner are the only paths that may, and they run as service role
  IF NEW.auction_status IS DISTINCT FROM OLD.auction_status THEN
    RAISE EXCEPTION 'slot %: auction_status may not be set by a client', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slots_client_writable ON sponsorship_slots;
CREATE TRIGGER trg_slots_client_writable
  BEFORE UPDATE ON sponsorship_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_slots_client_writable();

-- ============= CREATOR PROFILES =============
CREATE OR REPLACE FUNCTION public.tg_creator_profiles_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'profile_id', 'updated_at',
    'occupation', 'location', 'country_code', 'followers', 'impressions',
    'social_links', 'audience_description'
  ];
  v_changed text[];
BEGIN
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_changed := public.v_changed_columns(to_jsonb(OLD), to_jsonb(NEW), v_allowed);

  IF cardinality(v_changed) > 0 THEN
    RAISE EXCEPTION
      'creator profile %: client may only set presentation columns: %',
      NEW.profile_id, array_to_string(v_changed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creator_profiles_client_writable ON creator_profiles;
CREATE TRIGGER trg_creator_profiles_client_writable
  BEFORE UPDATE ON creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_creator_profiles_client_writable();

-- ============= REVIEWS =============
-- No column diff here: this guard only forbids reassigning the two identity columns,
-- which an RLS policy cannot express because policies cannot see OLD (see 0003).
-- It still had defect (1) — it read the guard as the client — so it is SECURITY
-- DEFINER now too.
CREATE OR REPLACE FUNCTION public.tg_reviews_client_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, public
AS $$
BEGIN
  IF app.guard_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.sponsorship_id IS DISTINCT FROM OLD.sponsorship_id THEN
    RAISE EXCEPTION 'review %: sponsorship_id may not be changed', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'review %: brand_id may not be changed', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_client_writable ON reviews;
CREATE TRIGGER trg_reviews_client_writable
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_reviews_client_writable();
