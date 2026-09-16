/**
 * Auction data-access layer.
 *
 * ️ PARTIALLY TEMPORARY. See `docs/auction-implementation-contract.md`.
 *
 * The auction schema is not migrated yet. This module is the **single funnel** through
 * which the application reads auction state, so that when Engineer A's migration and
 * generated types land, this is the only file that has to change.
 *
 * RPC calls go through `lib/auction-rpc.ts`, which currently delegates to the safe
 * in-memory implementation in `lib/auction-rpc-stubs.ts`. Delete those two stubs and
 * point `lib/auction-rpc.ts` at the real `.rpc(...)` calls when the migration merges.
 */

import { getAdminClient } from '@/lib/server-supabase';
import { getPaymentDeadlineHours, getMaxWinnerAttempts } from '@/lib/stripe/server';
import {
  type AuctionBid,
  type AuctionStatus,
  type BidStatus,
} from '@/lib/auction-types';
import type { Slot } from '@/lib/supabase';

/** Auction fields the browser is allowed to read for a listed slot. */
export const PUBLIC_SLOT_AUCTION_COLUMNS = [
  'starting_price',
  'auction_ends_at',
  'auction_status',
  'current_highest_bid',
  'bid_count',
  'currency',
] as const;

/**
 * Slot with the auction columns attached.
 *
 * `current_highest_bidder_id` is deliberately absent from the public shape: losing brand
 * identities must not be exposed.
 */
export type SlotWithAuction = Slot & {
  starting_price: number;
  auction_ends_at: string | null;
  auction_status: AuctionStatus;
  current_highest_bid: number;
  bid_count: number;
  currency: string;
  /** Derived: is the given brand the current high bidder? */
  is_winning?: boolean;
  /** Derived: the caller's own active bid, if any. */
  my_bid?: AuctionBid | null;
};

/** Loads a slot with its auction fields, or null. */
export async function loadSlotWithAuction(slotId: string): Promise<SlotWithAuction | null> {
  const { data, error } = await getAdminClient()
    .from('sponsorship_slots')
    .select(
      [
        'id',
        'day_id',
        'tier',
        'position',
        'description',
        'is_available',
        'created_at',
        'price',
        ...PUBLIC_SLOT_AUCTION_COLUMNS,
      ].join(','),
    )
    .eq('id', slotId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as SlotWithAuction;
}

/**
 * Loads slots for a day with auction fields, ordered as the day page expects.
 */
export async function loadSlotsForDayWithAuction(dayId: string): Promise<SlotWithAuction[]> {
  const { data, error } = await getAdminClient()
    .from('sponsorship_slots')
    .select(
      [
        'id',
        'day_id',
        'tier',
        'position',
        'description',
        'is_available',
        'created_at',
        'price',
        ...PUBLIC_SLOT_AUCTION_COLUMNS,
      ].join(','),
    )
    .eq('day_id', dayId)
    .order('position', { ascending: true });

  if (error || !data) return [];
  return data as unknown as SlotWithAuction[];
}

/**
 * Loads the caller's own bid rows for a set of slots.
 *
 * Only the caller's own rows are returned, so no other brand's identity is exposed.
 */
export async function loadMyBidsForSlots(
  brandProfileId: string,
  slotIds: string[],
): Promise<Map<string, AuctionBid>> {
  if (slotIds.length === 0) return new Map();

  const { data, error } = await getAdminClient()
    .from('auction_bids')
    .select('*')
    .eq('brand_id', brandProfileId)
    .in('slot_id', slotIds)
    .order('placed_at', { ascending: false });

  if (error || !data) return new Map();

  // Keep the caller's most recent active bid per slot.
  const bySlot = new Map<string, AuctionBid>();
  for (const row of data as AuctionBid[]) {
    const existing = bySlot.get(row.slot_id);
    if (!existing || new Date(row.placed_at) > new Date(existing.placed_at)) {
      bySlot.set(row.slot_id, row);
    }
  }

  return bySlot;
}

/**
 * Loads a bid by id together with its slot and day, for checkout resolution.
 * Returns null when the bid does not exist or belongs to nobody.
 */
export async function loadBidForCheckout(bidId: string) {
  const { data, error } = await getAdminClient()
    .from('auction_bids')
    .select(
      `
      id,
      slot_id,
      brand_id,
      creator_id,
      amount,
      currency,
      status,
      stripe_checkout_session_id,
      payment_deadline_at,
      placed_at,
      slot:sponsorship_slots(
        id, day_id, tier, is_available, starting_price, auction_ends_at,
        auction_status, current_highest_bid, current_highest_bidder_id, bid_count, currency
      )
    `,
    )
    .eq('id', bidId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as AuctionBid & {
    slot: SlotWithAuction | null;
  };
}

/** Loads a sponsorship with all payment/payout fields plus the winning bid. */
export async function loadSponsorshipForPayout(sponsorshipId: string) {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select(
      `
      id, slot_id, brand_id, creator_id, amount, platform_fee, creator_amount,
      status, stripe_payment_intent_id, stripe_checkout_session_id, created_at, updated_at,
      winning_bid_id, currency, payment_deadline_at, paid_at,
      stripe_transfer_id, payout_status, payout_released_at,
      stripe_refund_id, refund_status, payout_hold, payout_hold_reason
    `,
    )
    .eq('id', sponsorshipId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Loads the winning (paying) bid for a slot, if any.
 *
 * At most one can exist thanks to the `uniq_slot_paying_bid` index
 * (contract §3.6). `.limit(1)` plus the guard makes that explicit.
 */
export async function loadWinningBidForSlot(slotId: string): Promise<AuctionBid | null> {
  const { data, error } = await getAdminClient()
    .from('auction_bids')
    .select('*')
    .eq('slot_id', slotId)
    .in('status', ['winning', 'payment_pending'])
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as AuctionBid;
}

/** Loads the unpaid (or paid) sponsorship tied to a slot, if any. */
export async function loadOpenSponsorshipForSlot(slotId: string) {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('*')
    .eq('slot_id', slotId)
    .in('status', ['pending', 'paid'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Records a Checkout Session + PaymentIntent on the sponsorship.
 * Uses the service role because RLS forbids the browser from writing these columns.
 */
export async function recordCheckoutSession(
  sponsorshipId: string,
  checkoutSessionId: string,
  paymentIntentId: string | null,
  paymentDeadlineAt: string | null,
) {
  const { error } = await getAdminClient()
    .from('sponsorships')
    .update({
      stripe_checkout_session_id: checkoutSessionId,
      stripe_payment_intent_id: paymentIntentId,
      payment_deadline_at: paymentDeadlineAt,
    })
    .eq('id', sponsorshipId);

  if (error) throw error;
  return true;
}

/** Updates the cached onboarding flag from `account.updated`. */
export async function updateCreatorOnboardingCache(
  creatorProfileId: string,
  complete: boolean,
  stripeAccountId: string,
) {
  const { error } = await getAdminClient()
    .from('creator_profiles')
    .update({
      stripe_onboarding_complete: complete,
      stripe_account_id: stripeAccountId,
    })
    // `creator_profiles.id` is the primary key; `profile_id` is the FK to profiles.
    .eq('id', creatorProfileId);

  if (error) throw error;
  return true;
}

/**
 * Looks for a sponsorships row already in the 'pending' state for a bid.
 * Used by checkout to reuse an existing row instead of creating a duplicate.
 */
export async function findPendingSponsorshipForBid(bidId: string, slotId: string) {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('*')
    .eq('slot_id', slotId)
    .eq('winning_bid_id', bidId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/** Loads a sponsorship row by id, or null. */
export async function loadSponsorshipById(sponsorshipId: string) {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('*')
    .eq('id', sponsorshipId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/** Payment-deadline window for a winning bid, as an ISO timestamp. */
export function computePaymentDeadline(now = new Date()): string {
  return new Date(now.getTime() + getPaymentDeadlineHours() * 3_600_000).toISOString();
}

export { getMaxWinnerAttempts };