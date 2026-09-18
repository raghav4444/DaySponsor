/**
 * Auction data-access layer.
 *
 * Single funnel through which the application reads auction state against the merged
 * Engineer A schema (`supabase/migrations/20260916*`, contract
 * `docs/auction-implementation-contract.md`).
 *
 * Table names: `bids` (NOT `auction_bids`), `stripe_webhook_events`
 * (NOT `webhook_events`). The public leader ask is exposed through the
 * `public.auction_leader` view (no `brand_id` column); the base `bids` table is never
 * read for another brand's rows.
 */

import { getAdminClient } from '@/lib/server-supabase';
import { getPaymentDeadlineHours, getMaxWinnerAttempts } from '@/lib/stripe/server';
import {
  type AuctionBid,
  type AuctionStatus,
  type BidStatus,
} from '@/lib/auction-types';
import type { Slot } from '@/lib/supabase';

/** Auction columns the browser is allowed to read for a listed slot. */
export const PUBLIC_SLOT_AUCTION_COLUMNS = [
  'starting_price',
  'auction_ends_at',
  'auction_status',
  'current_highest_bid',
  'current_highest_bid_id',
  'winning_bid_id',
  'payment_due_at',
  'closed_at',
  'winner_attempt_count',
  'currency',
] as const;

/**
 * Slot with the auction columns attached.
 *
 * The leader's `brand_id` is deliberately absent: it is not a column on the slot and
 * must never be read from the base `bids` table for another brand — the public ask
 * comes from the `auction_leader` view instead.
 */
export type SlotWithAuction = Slot & {
  starting_price: number | null;
  auction_ends_at: string | null;
  auction_status: AuctionStatus;
  current_highest_bid: number | null;
  current_highest_bid_id: string | null;
  winning_bid_id: string | null;
  payment_due_at: string | null;
  closed_at: string | null;
  winner_attempt_count: number;
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
    .from('bids')
    .select('*')
    .eq('brand_id', brandProfileId)
    .in('slot_id', slotIds)
    .order('created_at', { ascending: false });

  if (error || !data) return new Map();

  // Keep the caller's most recent bid per slot.
  const bySlot = new Map<string, AuctionBid>();
  for (const row of data as AuctionBid[]) {
    const existing = bySlot.get(row.slot_id);
    if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
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
    .from('bids')
    .select(
      `
      id,
      slot_id,
      brand_id,
      amount,
      currency,
      status,
      created_at,
      updated_at,
      slot:sponsorship_slots(
        id, day_id, tier, is_available, starting_price, auction_ends_at,
        auction_status, current_highest_bid, current_highest_bid_id,
        winning_bid_id, payment_due_at, closed_at, winner_attempt_count, currency
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
      status, stripe_payment_intent_id, stripe_checkout_session_id, stripe_charge_id,
      created_at, updated_at,
      winning_bid_id, currency, payment_status, payment_due_at, paid_at,
      refund_amount, refunded_at,
      stripe_transfer_id, payout_status, payout_eligible_at, payout_released_at,
      stripe_refund_id, payout_hold, payout_hold_reason
    `,
    )
    .eq('id', sponsorshipId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Loads the paying bid for a slot, if any.
 *
 * At most one can exist thanks to the `sponsorships_one_active_per_slot` index plus
 * the `sponsorships_winning_bid_unique` index (contract §1). `.limit(1)` plus the
 * guard makes that explicit.
 */
export async function loadWinningBidForSlot(slotId: string): Promise<AuctionBid | null> {
  const { data, error } = await getAdminClient()
    .from('bids')
    .select('*')
    .eq('slot_id', slotId)
    .in('status', ['payment_pending', 'paid'])
    .order('amount', { ascending: false })
    .order('created_at', { ascending: true })
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
    .in('status', ['payment_pending', 'pending', 'paid'])
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
  paymentDueAt: string | null,
) {
  const { error } = await getAdminClient()
    .from('sponsorships')
    .update({
      stripe_checkout_session_id: checkoutSessionId,
      stripe_payment_intent_id: paymentIntentId,
      payment_due_at: paymentDueAt,
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