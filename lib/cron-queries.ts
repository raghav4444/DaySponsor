/**
 * Scheduled-job queries.
 *
 * Every query here discovers its own work from the database. The cron routes pass no
 * user ids and no amounts — they only say "run now" — so there is no request parameter
 * anywhere in this module that could steer a payout toward a chosen sponsorship.
 *
 * All queries use the service-role admin client: RLS would otherwise block the
 * cross-user reads the jobs need, and these routes are server-only and secret-guarded.
 */

import { getAdminClient } from '@/lib/server-supabase';

/**
 * Sponsorships that are paid but not yet transferred, and are not on hold.
 *
 * These are the *candidates* for the payout-retry job. Being a candidate does not mean
 * the money moves: `releasePayout` re-runs every precondition before touching Stripe, so
 * a row that has since been refunded or held is simply skipped.
 */
export async function loadPayoutCandidates(): Promise<
  {
    id: string;
    creator_id: string;
    creator_amount: number;
    currency: string | null;
    stripe_transfer_id: string | null;
  }[]
> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('id, creator_id, creator_amount, currency, stripe_transfer_id')
    .eq('status', 'paid')
    .is('stripe_transfer_id', null)
    .eq('payout_hold', false)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  return data as unknown as {
    id: string;
    creator_id: string;
    creator_amount: number;
    currency: string | null;
    stripe_transfer_id: string | null;
  }[];
}

/**
 * Sponsorships that should have been paid by now but were not, for the reconciliation
 * report. "Should have been paid" means paid status with no transfer and no hold —
 * anything on hold is an admin decision and is excluded rather than counted as drift.
 */
export async function loadUnreconciledSponsorships(): Promise<
  { id: string; created_at: string; creator_amount: number }[]
> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('id, created_at, creator_amount')
    .eq('status', 'paid')
    .is('stripe_transfer_id', null)
    .eq('payout_hold', false)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error || !data) return [];
  return data as unknown as { id: string; created_at: string; creator_amount: number }[];
}

/**
 * Slots whose auctions ended without a paying winner, for the reconciliation report.
 * Read-only: an admin decides what to do with them.
 */
export async function loadEndedWithoutWinnerSlots(): Promise<
  { id: string; day_id: string; tier: string | null; auction_status: string | null }[]
> {
  const { data, error } = await getAdminClient()
    .from('sponsorship_slots')
    .select('id, day_id, tier, auction_status')
    .in('auction_status', ['expired', 'cancelled'])
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error || !data) return [];
  return data as unknown as {
    id: string;
    day_id: string;
    tier: string | null;
    auction_status: string | null;
  }[];
}

/**
 * Sponsorships recorded as paid but whose charge has no successful payment intent, for
 * the reconciliation report. This is the drift the job exists to surface: a row that
 * claims money was taken that Stripe never confirmed.
 */
export async function loadPaidWithoutPaymentIntent(): Promise<{ id: string; status: string | null }[]> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('id, status')
    .eq('status', 'paid')
    .is('stripe_payment_intent_id', null)
    .limit(50);

  if (error || !data) return [];
  return data as unknown as { id: string; status: string | null }[];
}

/**
 * Bounded number of payout attempts per run, so one slow Stripe call cannot stall the
 * job. Fixed rather than configurable: a request parameter must never set a batch size.
 */
export const PAYOUT_BATCH_LIMIT = 25;
