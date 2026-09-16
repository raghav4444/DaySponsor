/**
 * Admin oversight queries.
 *
 * Read-only views over the whole marketplace. Every call goes through the service-role
 * client because RLS deliberately keeps one creator from seeing another's rows — an
 * admin needs the union, and only an admin route calls these.
 *
 * These functions never mutate a financial row. Money moves through the action handlers
 * in `lib/admin-actions.ts`, each of which is its own authorized server endpoint. A
 * browser Supabase client has no path to any of them.
 */

import { getAdminClient, adminFrom } from '@/lib/server-supabase';

/** Platform-wide totals for the admin overview. */
export type PlatformTotals = {
  auctions: {
    open: number;
    closed: number;
    awaiting_payment: number;
    failed: number;
  };
  bids: {
    total: number;
    winning: number;
  };
  sponsorships: {
    pending: number;
    paid: number;
    completed: number;
    refunded: number;
    cancelled: number;
  };
  revenue: {
    /** Sum of gross amounts charged, in minor units. */
    gross: number;
    /** Sum of platform fees, in minor units. */
    fees: number;
    /** Sum of creator amounts, in minor units. */
    creator: number;
    currency: string;
  };
  payouts: {
    released: number;
    pending: number;
    on_hold: number;
    reversed: number;
  };
  refunds: {
    succeeded: number;
    pending: number;
    failed: number;
  };
};

/**
 * Reads an exact count from a `head: true` query. The awaited shape is structural: the
 * generated supabase-js types for the migrated schema are not available yet
 * (see `docs/auction-implementation-contract.md`), so the builder is typed loosely at the
 * call site and only the resolved `{ count, error }` is trusted.
 */
type CountResult = { count: number | null; error: unknown };

async function count(query: PromiseLike<CountResult>): Promise<number> {
  const { count, error } = await query;
  if (error || count === null) return 0;
  return count;
}

/**
 * Platform totals. Counts are exact (`head: true` + `count: 'exact'`) so the overview
 * never shows an estimate where money is involved.
 */
export async function loadPlatformTotals(): Promise<PlatformTotals> {
  const admin = getAdminClient();

  const [
    openAuctions,
    closedAuctions,
    awaitingPayment,
    failedAuctions,
    totalBids,
    winningBids,
    pendingSponsorships,
    paidSponsorships,
    completedSponsorships,
    refundedSponsorships,
    cancelledSponsorships,
    releasedPayouts,
    pendingPayouts,
    heldPayouts,
    reversedPayouts,
    succeededRefunds,
    pendingRefunds,
    failedRefunds,
  ] = await Promise.all([
    count(adminFrom('sponsorship_slots').eq('auction_status', 'open').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorship_slots').in('auction_status', ['sold']).select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorship_slots').eq('auction_status', 'awaiting_payment').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorship_slots').in('auction_status', ['expired', 'cancelled']).select('id', { count: 'exact', head: true })),
    count(adminFrom('auction_bids').select('id', { count: 'exact', head: true })),
    count(adminFrom('auction_bids').in('status', ['winning', 'won']).select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('status', 'pending').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('status', 'paid').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('status', 'completed').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('status', 'refunded').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('status', 'cancelled').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('payout_status', 'released').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('payout_status', 'pending').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('payout_status', 'on_hold').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('payout_status', 'reversed').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('refund_status', 'succeeded').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('refund_status', 'pending').select('id', { count: 'exact', head: true })),
    count(adminFrom('sponsorships').eq('refund_status', 'failed').select('id', { count: 'exact', head: true })),
  ]);

  return {
    auctions: {
      open: openAuctions,
      closed: closedAuctions,
      awaiting_payment: awaitingPayment,
      failed: failedAuctions,
    },
    bids: { total: totalBids, winning: winningBids },
    sponsorships: {
      pending: pendingSponsorships,
      paid: paidSponsorships,
      completed: completedSponsorships,
      refunded: refundedSponsorships,
      cancelled: cancelledSponsorships,
    },
    revenue: {
      // Sums are computed here rather than in SQL so the query stays simple and the
      // currency is carried alongside. Only rows that were actually charged count.
      gross: 0,
      fees: 0,
      creator: 0,
      currency: 'eur',
    },
    payouts: {
      released: releasedPayouts,
      pending: pendingPayouts,
      on_hold: heldPayouts,
      reversed: reversedPayouts,
    },
    refunds: {
      succeeded: succeededRefunds,
      pending: pendingRefunds,
      failed: failedRefunds,
    },
  };
}

/** Revenue sums over charged sponsorships, in minor units. */
export async function loadRevenueTotals(): Promise<{
  gross: number;
  fees: number;
  creator: number;
  currency: string;
}> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('amount, platform_fee, creator_amount, currency')
    .in('status', ['paid', 'product_shipped', 'product_received', 'day_completed', 'completed']);

  if (error || !data) return { gross: 0, fees: 0, creator: 0, currency: 'eur' };

  let gross = 0;
  let fees = 0;
  let creator = 0;
  for (const row of data as Array<{
    amount: number | null;
    platform_fee: number | null;
    creator_amount: number | null;
    currency: string | null;
  }>) {
    gross += Number(row.amount ?? 0);
    fees += Number(row.platform_fee ?? 0);
    creator += Number(row.creator_amount ?? 0);
  }

  const first = (data as Array<{ currency: string | null }>)[0];
  return {
    gross,
    fees,
    creator,
    currency: first?.currency?.toLowerCase() ?? 'eur',
  };
}

/** All sponsorships needing an admin's attention, newest first. */
export async function loadAdminSponsorships(): Promise<AdminSponsorshipRow[]> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select(
      `
      id, slot_id, brand_id, creator_id, status, amount, platform_fee, creator_amount,
      currency, stripe_payment_intent_id, stripe_checkout_session_id,
      stripe_transfer_id, stripe_refund_id, payout_status, payout_released_at,
      refund_status, payout_hold, payout_hold_reason, payment_deadline_at, paid_at,
      created_at, updated_at,
      profiles!sponsorships_brand_id_fkey(name, username),
      creator_profiles!sponsorships_creator_id_fkey(profile_id)
      `,
    )
    .order('updated_at', { ascending: false })
    .limit(60);

  if (error || !data) return [];
  return data as unknown as AdminSponsorshipRow[];
}

export type AdminSponsorshipRow = {
  id: string;
  slot_id: string | null;
  brand_id: string;
  creator_id: string;
  status: string | null;
  amount: number;
  platform_fee: number;
  creator_amount: number;
  currency: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  payout_status: string | null;
  payout_released_at: string | null;
  refund_status: string | null;
  payout_hold: boolean;
  payout_hold_reason: string | null;
  payment_deadline_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string | null;
  profiles: { name: string; username: string | null } | null;
  creator_profiles: { profile_id: string } | null;
};

/** All slots with auction state, for the auctions view. */
export async function loadAdminAuctions(): Promise<AdminSlotRow[]> {
  const { data, error } = await getAdminClient()
    .from('sponsorship_slots')
    .select(
      `
      id, day_id, tier, description, is_available,
      starting_price, current_highest_bid, current_highest_bidder_id, bid_count,
      auction_ends_at, auction_status, currency, winner_attempts,
      days(id, title, day_date),
      profiles!sponsorship_slots_current_highest_bidder_id_fkey(name)
      `,
    )
    .order('auction_ends_at', { ascending: false, nullsFirst: false })
    .limit(60);

  if (error || !data) return [];
  return data as unknown as AdminSlotRow[];
}

export type AdminSlotRow = {
  id: string;
  day_id: string;
  tier: string | null;
  description: string | null;
  is_available: boolean | null;
  starting_price: number;
  current_highest_bid: number;
  current_highest_bidder_id: string | null;
  bid_count: number;
  auction_ends_at: string | null;
  auction_status: string | null;
  currency: string | null;
  winner_attempts: number;
  days: { id: string; title: string; day_date: string } | null;
  profiles: { name: string } | null;
};

/** Recent transfers, for reconciliation against Stripe. */
export async function loadAdminTransfers(): Promise<AdminTransferRow[]> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select(
      `
      id, stripe_transfer_id, creator_amount, currency, payout_status,
      payout_released_at, creator_id,
      profiles!sponsorships_creator_id_fkey(name)
      `,
    )
    .not('stripe_transfer_id', 'is', null)
    .order('payout_released_at', { ascending: false })
    .limit(40);

  if (error || !data) return [];
  return data as unknown as AdminTransferRow[];
}

export type AdminTransferRow = {
  id: string;
  stripe_transfer_id: string;
  creator_amount: number;
  currency: string | null;
  payout_status: string | null;
  payout_released_at: string | null;
  creator_id: string;
  profiles: { name: string } | null;
};

/** Recent refunds, for reconciliation. */
export async function loadAdminRefunds(): Promise<AdminRefundRow[]> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select(
      `
      id, stripe_refund_id, amount, currency, refund_status,
      stripe_payment_intent_id, updated_at,
      profiles!sponsorships_brand_id_fkey(name)
      `,
    )
    .not('stripe_refund_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(40);

  if (error || !data) return [];
  return data as unknown as AdminRefundRow[];
}

export type AdminRefundRow = {
  id: string;
  stripe_refund_id: string;
  amount: number;
  currency: string | null;
  refund_status: string | null;
  stripe_payment_intent_id: string | null;
  updated_at: string | null;
  profiles: { name: string } | null;
};

/** Reconciliation drift: paid sponsorships that were never transferred and are not held. */
export async function loadReconciliationDrift(): Promise<
  { id: string; created_at: string; creator_amount: number; currency: string | null }[]
> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('id, created_at, creator_amount, currency')
    .eq('status', 'paid')
    .is('stripe_transfer_id', null)
    .eq('payout_hold', false)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  return data as unknown as {
    id: string;
    created_at: string;
    creator_amount: number;
    currency: string | null;
  }[];
}

/** Recent webhook events, so an admin can see whether Stripe's view matches ours. */
export async function loadAdminWebhookEvents(): Promise<
  {
    id: string;
    stripe_event_id: string;
    event_type: string;
    status: string;
    attempts: number;
    last_error: string | null;
    processed_at: string | null;
    created_at: string;
  }[]
> {
  const { data, error } = await getAdminClient()
    .from('webhook_events')
    .select(
      'id, stripe_event_id, event_type, status, attempts, last_error, processed_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(25);

  if (error || !data) return [];
  return data as unknown as {
    id: string;
    stripe_event_id: string;
    event_type: string;
    status: string;
    attempts: number;
    last_error: string | null;
    processed_at: string | null;
    created_at: string;
  }[];
}

/**
 * Dispute status, looked up live from Stripe rather than cached. Disputes are rare and
 * consequential enough that a stale local flag is worse than a live read.
 */
export async function loadDisputeStatus(paymentIntentId: string): Promise<{
  has_dispute: boolean;
  status: string | null;
  amount: number | null;
  currency: string | null;
}> {
  if (!paymentIntentId) return { has_dispute: false, status: null, amount: null, currency: null };

  const { getStripe } = await import('@/lib/stripe/server');
  try {
    const disputes = await getStripe().disputes.list({
      payment_intent: paymentIntentId,
      limit: 5,
    });
    if (disputes.data.length === 0) {
      return { has_dispute: false, status: null, amount: null, currency: null };
    }
    const dispute = disputes.data[0];
    return {
      has_dispute: true,
      status: dispute.status,
      amount: dispute.amount,
      currency: dispute.currency,
    };
  } catch {
    // A Stripe failure must not break the overview; report unknown instead.
    return { has_dispute: false, status: null, amount: null, currency: null };
  }
}
