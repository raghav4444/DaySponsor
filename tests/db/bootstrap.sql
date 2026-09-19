-- Bootstrap a plain Postgres 15 instance so the Supabase migrations can be replayed.
-- The only Supabase-specific surface the schema uses is auth.uid(); we provide a
-- minimal `auth` schema with an auth.uid() implementation backed by a session table,
-- which is exactly what the real function resolves to in a request-scoped session.

CREATE SCHEMA IF NOT EXISTS auth;

-- Stand-in for auth.users. Real Supabase keys this table and profiles.user_id FKs it.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL
);

-- The request-scoped identity. Tests set it with test.as_user / test.as_anonymous.
CREATE TABLE IF NOT EXISTS auth._current_uid (uid uuid);
INSERT INTO auth._current_uid VALUES (NULL) ON CONFLICT DO NOTHING;

-- Identity resolution, mirroring how Supabase resolves the caller:
--   * test.as_user / test.as_anonymous pin the identity for the current session by
--     setting the `test.uid` GUC, which is what a JWT-backed request would do. It is
--     per-session, so two *concurrent* connections can act as two different brands —
--     which the parallel-bid concurrency test needs and a single shared table cannot
--     express (an UPDATE of a shared row would serialise the two sessions).
--   * with no GUC set, the table value is used. That keeps plain statements outside a
--     helper working, and yields NULL (=> UNAUTHENTICATED) in a seeded database.
-- An empty GUC means "explicitly anonymous" (auth.uid() IS NULL), which is distinct
-- from "GUC not set at all".
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('test.uid', true) IS NULL
      THEN (SELECT uid FROM auth._current_uid)
    ELSE nullif(current_setting('test.uid', true), '')::uuid
  END
$$;

-- Grant what Supabase grants, so SECURITY DEFINER functions and RLS policies resolve.
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT SELECT, UPDATE ON auth._current_uid TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

-- ============= ROLE PRIVILEGES (what Supabase's public schema looks like) =============
-- Supabase ships these default privileges on the public schema, so `anon` and
-- `authenticated` can reach tables/functions at all and RLS is what decides row access.
-- Without them a suite cannot run as `authenticated` at all, and RLS is never exercised:
-- the table owner (postgres) simply bypasses every policy.
--
-- Order matters in this repository: bootstrap.sql runs BEFORE the migrations, so these
-- ALTER DEFAULT PRIVILEGES apply to every table and function the migrations create.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- service_role bypasses RLS in Supabase; mirror that so service-role-only RPCs behave.
ALTER ROLE service_role BYPASSRLS;

-- gen_random_uuid() and the extensions Supabase preinstalls.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- gen_random_uuid() ships in pgcrypto on vanilla Postgres (Supabase preinstalls it).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase exposes these roles. Define them so the GRANT ... TO statements in the
-- migrations succeed on plain Postgres. They are not granted login.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END$$;

-- ============= TEST HELPERS =============
-- NOTE ON psql VARIABLES: ':var' interpolation is a *psql client* feature: it rewrites
-- the query text before the server ever sees it. It therefore CANNOT work inside a
-- string literal passed as an argument to a PL/pgSQL function, because that string is
-- data, not query text, by the time psql hands the statement to the server. Passing
-- $$ ... :'slot_id' ... $$ to test.as_user() makes EXECUTE see the literal characters
-- :"slot_id", which fails with "syntax error at or near ':'".
--
-- The suites instead bind ids as real function parameters: the id values live in the
-- `test.ids` table below and are looked up by name inside the helper, so no client-side
-- text substitution is involved at all.

CREATE SCHEMA IF NOT EXISTS test;

-- Named id registry. seed.sql inserts the fixed ids the suites address; each suite
-- resolves them with test.id('slot_id') etc. Keeping them in a table (rather than as
-- psql variables) is what makes the same SQL work under psql, a driver, or a job runner.
CREATE TABLE IF NOT EXISTS test.ids (
  name text PRIMARY KEY,
  value uuid NOT NULL
);

CREATE OR REPLACE FUNCTION test.id(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT value FROM test.ids WHERE name = p_name $$;

-- These helpers run as whatever role the suite calls them with (the owner, postgres),
-- and the body handed to test.as_user/test.as_anonymous is executed as `authenticated`.
-- The helpers are plain invoker functions, which is what allows them to switch role at
-- all (see the note on test.as_user).

-- Run a body as an authenticated user, in the `authenticated` DB role.
--   1. `SET LOCAL ROLE authenticated` puts RLS in force. Without this step every policy
--      is inert, because the table owner (postgres) bypasses RLS entirely — a suite that
--      runs as postgres would "pass" every security assertion while proving nothing.
--   2. `test.uid` carries the identity, the same axis a JWT claim occupies. It also lets
--      two concurrent connections act as two different brands (see auth.uid above).
--
-- SECURITY INVOKER, deliberately: Postgres refuses
--   "cannot set parameter "role" within security-definer function"
-- so the role switch is only possible from an invoker function. The suites call this as
-- the owner (postgres), which is what makes the switch legal and what allows the setup
-- statements around it to keep running as the owner.
CREATE OR REPLACE FUNCTION test.as_user(p_uid uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_uid uuid;
  v_prev_guc text := current_setting('test.uid', true);
BEGIN
  SELECT uid INTO v_prev_uid FROM auth._current_uid;

  UPDATE auth._current_uid SET uid = p_uid;
  PERFORM set_config('test.uid', COALESCE(p_uid::text, ''), true);
  SET LOCAL ROLE authenticated;

  BEGIN
    EXECUTE p_body;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    UPDATE auth._current_uid SET uid = v_prev_uid;
    -- Restore "no GUC set" as an empty (explicitly anonymous) identity; see auth.uid().
    PERFORM set_config('test.uid', COALESCE(v_prev_guc, ''), true);
    RAISE;
  END;

  RESET ROLE;
  UPDATE auth._current_uid SET uid = v_prev_uid;
  PERFORM set_config('test.uid', COALESCE(v_prev_guc, ''), true);
END;
$$;

-- Run a body with NO authenticated user (auth.uid() IS NULL) but still in the
-- `authenticated` role, which is the case "logged-in role, no valid identity" and is
-- what the UNAUTHENTICATED guards defend. `anon` is a separate assertion: the
-- service/client-only RPCs are not EXECUTE-able by `anon` at all (see 06_security.sql).
CREATE OR REPLACE FUNCTION test.as_anonymous(p_body text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_uid uuid;
  v_prev_guc text := current_setting('test.uid', true);
BEGIN
  SELECT uid INTO v_prev_uid FROM auth._current_uid;

  UPDATE auth._current_uid SET uid = NULL;
  PERFORM set_config('test.uid', '', true);
  SET LOCAL ROLE authenticated;

  BEGIN
    EXECUTE p_body;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    UPDATE auth._current_uid SET uid = v_prev_uid;
    PERFORM set_config('test.uid', COALESCE(v_prev_guc, ''), true);
    RAISE;
  END;

  RESET ROLE;
  UPDATE auth._current_uid SET uid = v_prev_uid;
  PERFORM set_config('test.uid', COALESCE(v_prev_guc, ''), true);
END;
$$;

-- Run a body and SWALLOW its failure, returning NULL when it succeeded or
-- '<SQLSTATE>:<message>' when it did not.
--
-- Security assertions need both denial styles to be tolerable, because the two guards
-- fail differently on purpose:
--   * RLS denies silently — the statement succeeds and touches zero rows.
--   * the column guards RAISE check_violation — the statement aborts.
-- The suites then assert on the EFFECT (the row is unchanged), which is the property
-- that actually matters and is the same under either denial.
CREATE OR REPLACE FUNCTION test.attempt(p_body text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_body;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END;
$$;

-- Run a body as a given identity and RETURN the jsonb it produces.
--
-- Same identity mechanics as test.as_user, but it hands the RPC's return value back to
-- the caller, which is how the suites assert on the payload the integration contract
-- promises ({"ok": true, "error": null, "amount": ..., ...}) instead of only on the rows
-- the call left behind.
CREATE OR REPLACE FUNCTION test.call_as(p_uid uuid, p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_uid uuid;
  v_prev_guc text := current_setting('test.uid', true);
  v_result jsonb;
BEGIN
  IF p_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_uid) THEN
    RAISE EXCEPTION 'test.call_as: % is not an auth.users id', p_uid;
  END IF;

  SELECT uid INTO v_prev_uid FROM auth._current_uid;
  UPDATE auth._current_uid SET uid = p_uid;
  PERFORM set_config('test.uid', COALESCE(p_uid::text, ''), true);
  SET LOCAL ROLE authenticated;

  BEGIN
    EXECUTE p_sql INTO v_result;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    UPDATE auth._current_uid SET uid = v_prev_uid;
    PERFORM set_config('test.uid', COALESCE(v_prev_guc, ''), true);
    RAISE;
  END;

  RESET ROLE;
  UPDATE auth._current_uid SET uid = v_prev_uid;
  PERFORM set_config('test.uid', COALESCE(v_prev_guc, ''), true);
  RETURN v_result;
END;
$$;

-- Run a body as an identity in the `authenticated` role and report the OUTCOME:
--   NULL                -> the statement went through
--   '<SQLSTATE>:<msg>'  -> it was refused
--
-- This is what the security suites assert on. A denial has two legitimate shapes and both
-- must be observable:
--   * RLS filters silently (a row the policy does not admit simply is not touched);
--   * the column guards and the CHECK constraints raise.
-- Either way the suite also asserts the EFFECT on the row, which is the property that
-- actually matters, so "the client got a 200" can never be mistaken for "the client won".
CREATE OR REPLACE FUNCTION test.attempt_as(p_uid uuid, p_body text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_uid uuid;
  v_prev_guc text := current_setting('test.uid', true);
  v_result text;
BEGIN
  SELECT uid INTO v_prev_uid FROM auth._current_uid;
  UPDATE auth._current_uid SET uid = p_uid;
  PERFORM set_config('test.uid', COALESCE(p_uid::text, ''), true);
  SET LOCAL ROLE authenticated;

  BEGIN
    EXECUTE p_body;
    v_result := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ':' || SQLERRM;
  END;

  RESET ROLE;
  UPDATE auth._current_uid SET uid = v_prev_uid;
  PERFORM set_config('test.uid', COALESCE(v_prev_guc, ''), true);
  RETURN v_result;
END;
$$;

-- Run a SETUP body with the column guard lifted.
--
-- The suites need starting states that no legitimate client path can produce: an auction
-- whose payment deadline has already passed, a slot already settled, and so on. This
-- helper calls app.set_guard(), whose EXECUTE is revoked from PUBLIC, anon and
-- authenticated — so it is a back door for the OWNER running the suite only. A browser
-- role calling it gets a hard "permission denied for schema app", which is the intended
-- production behaviour and is asserted in 06_security.sql.
--
-- Rule of use: arrange state with it, never assert state through it.
CREATE OR REPLACE FUNCTION test.as_owner(p_body text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM app.set_guard(false);
  EXECUTE p_body;
  PERFORM app.set_guard(true);
EXCEPTION WHEN OTHERS THEN
  PERFORM app.set_guard(true);
  RAISE;
END;
$$;

-- Assert two values are equal; raises a labelled error otherwise.
CREATE OR REPLACE FUNCTION test.assert_eq(p_expected text, p_actual text, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_expected IS DISTINCT FROM p_actual THEN
    RAISE EXCEPTION 'ASSERT_EQ FAILED [%]: expected %, got %', p_label, p_expected, p_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION test.assert_true(p_cond boolean, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_cond THEN
    RAISE EXCEPTION 'ASSERT_TRUE FAILED [%]', p_label;
  END IF;
END;
$$;

-- The suites run as `authenticated` inside test.as_user, so EXECUTE on these helpers has
-- to be granted to it. They are test-only objects in the `test` schema; nothing in
-- supabase/migrations/ or the application depends on them.
GRANT USAGE ON SCHEMA test TO PUBLIC;
GRANT SELECT ON test.ids TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA test GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
