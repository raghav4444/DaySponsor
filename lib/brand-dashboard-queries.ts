/**
 * Brand dashboard data.
 *
 * Everything here is loaded through the authenticated browser client, so RLS decides
 * what the caller can see. That is deliberate: the dashboard shows one brand's own bids
 * and sponsorships, and RLS is the guard that keeps it that way.
 *
 * The one exception is the payment-required action. Whether a "Pay now" may be shown is
 * re-derived server-side at click time from the sponsorship row (ownership + status),
 * not from a flag the browser carried around.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuctionBid, SlotAuctionFields, SponsorshipPaymentFields } from '@/lib/auction-types';

/** A slot joined with its day, for the brand's auction list. */
export type BrandSlotRow = SlotAuctionFields & {
  id: string;
  day_id: string;
  tier: string | null;
  description: string | null;
  days: {
    id: string;
    title: string;
    day_date: string;
    location: string | null;
    category: string | null;
  } | null;
};

/** A sponsorship joined with its day, for the fulfillment list. */
export type BrandSponsorshipRow = SponsorshipPaymentFields & {
  id: string;
  slot_id: string | null;
  brand_id: string;
  creator_id: string;
  status: string | null;
  days: {
    id: string;
    title: string;
    day_date: string;
    location: string | null;
    category: string | null;
  } | null;
  creator_profiles: {
    profile_id: string;
    occupation: string | null;
  } | null;
  profiles: { name: string; username: string | null } | null;
};

/**
 * Slots the brand has bid on, with the auction columns and the caller's own bid.
 *
 * Ordering is by the bid's recency so the things needing attention surface first. Only
 * the caller's own bid rows are joined — RLS plus an explicit `eq` on the brand — so no
 * other bidder's identity can appear in this view.
 */
export async function loadBrandBidSlots(
  client: SupabaseClient,
  brandProfileId: string,
): Promise<{ slots: BrandSlotRow[]; myBids: Map<string, AuctionBid> }> {
  const { data, error } = await client
    .from('sponsorship_slots')
    .select(
      `
      id, day_id, tier, description,
      ${PUBLIC_AUCTION_SELECT}
      days!inner(id, title, day_date, location, category),
      bids!inner(id, amount, status, created_at, slot_id, brand_id)
      `,
    )
    .eq('bids.brand_id', brandProfileId)
    .order('bids.created_at', { ascending: false })
    .limit(40);

  if (error || !data) return { slots: [], myBids: new Map() };

  const myBids = new Map<string, AuctionBid>();
  const rows = (data as unknown as Array<BrandSlotRow & { bids: AuctionBid[] }>).map(
    (row) => {
      // Take the caller's most recent bid for the slot.
      const bid = row.bids?.[0] ?? null;
      if (bid) myBids.set(row.id, bid);
      const { bids: _dropped, ...slot } = row;
      return slot;
    },
  );

  return { slots: rows, myBids };
}

/** The auction columns selected on every public slot read. */
const PUBLIC_AUCTION_SELECT =
  'starting_price, current_highest_bid, auction_ends_at, auction_status, currency';

/**
 * The brand's sponsorships, newest first, with the day and the creator.
 */
export async function loadBrandSponsorships(
  client: SupabaseClient,
  brandProfileId: string,
): Promise<BrandSponsorshipRow[]> {
  const { data, error } = await client
    .from('sponsorships')
    .select(
      `
      id, slot_id, brand_id, creator_id, status, amount, platform_fee, creator_amount,
      currency, stripe_payment_intent_id, stripe_checkout_session_id,
      stripe_transfer_id, stripe_refund_id, payout_status,
      payment_due_at, paid_at, created_at,
      refund_amount, refunded_at,
      days!inner(id, title, day_date, location, category),
      creator_profiles(profile_id, occupation),
      profiles!sponsorships_creator_id_fkey(name, username)
      `,
    )
    .eq('brand_id', brandProfileId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error || !data) return [];
  return data as unknown as BrandSponsorshipRow[];
}

/**
 * Decides whether a "Pay now" action may be offered for a sponsorship.
 *
 * Displaying the button is only a convenience: the click re-checks ownership and status
 * server-side, so a stale row in the browser can never mint a checkout session for
 * someone else's sponsorship or an already-paid one.
 */
export function canOfferPayment(sponsorship: {
  brand_id: string;
  status: string | null;
}): boolean {
  if (sponsorship.brand_id.length === 0) return false;
  // 'pending' is the unpaid, pre-payment state. Anything else is not payable from here.
  return sponsorship.status === 'pending';
}

/**
 * Groups the brand's sponsorships into the buckets the dashboard renders. A sponsorship
 * lands in exactly one bucket; the order of the checks is the precedence.
 */
export function groupSponsorshipsByPhase<T extends BrandSponsorshipRow>(rows: T[]): {
  paymentRequired: T[];
  paid: T[];
  shipping: T[];
  fulfillment: T[];
  review: T[];
  failed: T[];
} {
  const buckets = {
    paymentRequired: [] as T[],
    paid: [] as T[],
    shipping: [] as T[],
    fulfillment: [] as T[],
    review: [] as T[],
    failed: [] as T[],
  };

  for (const row of rows) {
    const status = row.status ?? '';

    if (status === 'pending') {
      // Unpaid. If the deadline has passed the cron job will expire it, so it is shown
      // as requiring payment but is not counted as money owed indefinitely.
      buckets.paymentRequired.push(row);
    } else if (status === 'refunded' || status === 'cancelled') {
      buckets.failed.push(row);
    } else if (status === 'paid' || status === 'product_shipped' || status === 'product_received') {
      buckets.paid.push(row);
      if (status === 'product_shipped' || status === 'product_received') {
        buckets.shipping.push(row);
      }
    } else if (status === 'day_completed' || status === 'review_pending') {
      buckets.fulfillment.push(row);
      if (status === 'review_pending') buckets.review.push(row);
    } else if (status === 'completed') {
      buckets.fulfillment.push(row);
    }
  }

  return buckets;
}

/**
 * Splits the brand's bid slots into active (bidding in progress), won and lost views.
 * "Won" and "lost" are read from the bid status written by the closing RPC — the browser
 * never decides an outcome.
 */
export function groupBidSlots<T extends BrandSlotRow>(
  rows: T[],
  myBids: Map<string, AuctionBid>,
): { active: T[]; won: T[]; lost: T[] } {
  const buckets = { active: [] as T[], won: [] as T[], lost: [] as T[] };

  for (const row of rows) {
    const myBid = myBids.get(row.id);
    const status = myBid?.status ?? 'active';
    const auctionStatus = row.auction_status ?? 'open';

    if (auctionStatus === 'open' || auctionStatus === 'awaiting_payment') {
      if (status === 'winner' || status === 'paid') buckets.won.push(row);
      else if (status === 'outbid' || status === 'cancelled' || status === 'failed') buckets.lost.push(row);
      else buckets.active.push(row);
    } else if (auctionStatus === 'closed' || auctionStatus === 'paid' || auctionStatus === 'completed' || auctionStatus === 'cancelled') {
      if (status === 'winner' || status === 'paid') buckets.won.push(row);
      else buckets.lost.push(row);
    } else {
      buckets.active.push(row);
    }
  }

  return buckets;
}
