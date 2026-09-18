/*
# DaySponsor — RPC privilege hardening and payout_status fix (Phase 8, continued)

A forward migration. It changes no function body except the one CHECK below; migrations
0004–0007 are not modified by it.

## 1. `payout_status = 'cancelled'` was an unsatisfiable write

`record_refund` (migration 0006) marks the payout `'cancelled'`, but
`sponsorships_payout_status_check` from migration 0001 only admitted
`pending | eligible | released | failed`. Every refund therefore died with a 23514
*after* the function had already flipped `status = 'refunded'` inside its own
transaction. The two are now consistent, and `cancelled` is the right value: a refunded
sponsorship must never pay out, and "cancelled" is not the same claim as "failed"
(nothing was attempted).

## 2. Privileges: which role may call which RPC

Migrations 0004–0006 granted far too much. They revoked from `PUBLIC` and `anon`, then
granted EXECUTE to `authenticated` — including for the five routines that exist *only*
for the service role:

    close_expired_auction, expire_unpaid_winner,      -- scheduler / cron
    mark_sponsorship_paid, record_refund, release_payout   -- Stripe webhook

`mark_sponsorship_paid` in particular is a SECURITY DEFINER function that flips
`payment_status` to `'paid'`, settles the winning bid and marks the slot paid. Granted to
`authenticated`, it let any logged-in brand mark its own sponsorship paid without paying
— row-level security never enters into it, because the function runs as its owner. The
Phase 8 requirement is that a normal browser client cannot mark payment successful or
trigger/mark a payout, so EXECUTE is now revoked from `authenticated` for those five.

The four routines that *are* part of the browser surface stay available to
`authenticated`, and are revoked from `anon`:

    place_bid            -- derives the brand from auth.uid()
    open_auction         -- requires the Day's creator
    advance_fulfillment  -- requires being a party, and the correct party per edge
    submit_review        -- requires the sponsorship's creator

Every one of those derives ownership from `auth.uid()` internally, so holding EXECUTE is
never sufficient on its own.

The internal `v_*` helpers (and the transition predicate) are implementation details of
the guards and the RPCs. They are all invoked from SECURITY DEFINER contexts that run as
the owner, so they are revoked from clients entirely.

Nothing here relaxes RLS, and no policy is dropped.
*/

-- ============= 1. PAYOUT MAY BE CANCELLED BY A REFUND =============
ALTER TABLE sponsorships DROP CONSTRAINT IF EXISTS sponsorships_payout_status_check;
ALTER TABLE sponsorships ADD CONSTRAINT sponsorships_payout_status_check
  CHECK (payout_status IN ('pending', 'eligible', 'released', 'failed', 'cancelled'));

-- ============= 2. SERVICE-ROLE-ONLY ROUTINES =============
-- Scheduler / webhook surface. A browser client can never reach these.
REVOKE ALL ON FUNCTION public.close_expired_auction(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_unpaid_winner(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_sponsorship_paid(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_refund(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_payout(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.close_expired_auction(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_winner(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_sponsorship_paid(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_refund(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_payout(uuid, text) TO service_role;

-- ============= 3. AUTHENTICATED-ONLY ROUTINES =============
REVOKE ALL ON FUNCTION public.place_bid(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.open_auction(uuid, bigint, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_auction(uuid, bigint, text, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.advance_fulfillment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_fulfillment(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_review(uuid, integer, text, text, text[], text[], boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, integer, text, text, text[], text[], boolean, text, text) TO authenticated, service_role;

-- ============= 4. INTERNAL HELPERS: NOT PART OF ANY CLIENT SURFACE =============
REVOKE ALL ON FUNCTION public.v_rpc_error(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v_amount_below_start(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v_current_leader_amount(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v_next_eligible_bid(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v_split_money(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v_payment_deadline(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v_changed_columns(jsonb, jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsorships_status_transition_ok(text, text) FROM PUBLIC, anon, authenticated;

-- ============= 5. TRIGGER FUNCTIONS ARE NOT RPCs =============
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn.sig);
  END LOOP;
END;
$$;