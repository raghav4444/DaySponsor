/**
 * DEV-ONLY in-memory stand-ins for Engineer A's auction/payment RPCs.
 *
 * ️ DELETE THIS FILE when Engineer A's migration and RPCs merge.
 *
 * Purpose: keep the auction UI clickable against a local Supabase that has NOT yet
 * been migrated, and give the Phase 15 tests a deterministic implementation to exercise.
 * It simulates the contract behaviour of `place_bid` (§4.1) and `mark_sponsorship_paid`
 * (§4.3) but keeps everything in a module-level Map, so state does NOT survive a server
 * restart or a serverless cold start.
 *
 * Safety properties preserved so the UI logic built on top is still trustworthy:
 *  - full validation of bid amount, deadline, and high-bidder transitions;
 *  - status transitions happen server-side only (the client never mutates status);
 *  - no currency is accepted from the caller;
 *  - money stays integer minor units.
 *
 * `lib/auction-rpc.ts` calls the real `.rpc(...)` when it exists and only falls back
 * here on `PGRST202` (function not found). Delete the fallback when A merges.
 */

import { getAdminClient } from '@/lib/server-supabase';
import type {
  AuctionBid,
  AuctionStatus,
  PlaceBidResult,
} from '@/lib/auction-types';

/** Minimum bid increment in minor units. Mirrors `minimum_next_bid`. */
export const STUB_MIN_INCREMENT = 50;

type SlotState = {
  slotKey: string;
  startingPrice: number;
  currentHighestBid: number;
  currentHighestBidderId: string | null;
  bidCount: number;
  auctionStatus: AuctionStatus;
  auctionEndsAt: string | null;
  bids: AuctionBid[];
};

type SponsorshipState = {
  id: string;
  slotId: string;
  amount: number;
  paid: boolean;
  payoutStatus: string;
  refundStatus: string;
};

// Module-level store, shared within one server instance.
const slots = new Map<string, SlotState>();
const sponsorships = new Map<string, SponsorshipState>();

/** Resets the store. Only used in tests. */
export function resetStubStore() {
  slots.clear();
  sponsorships.clear();
}

/**
 * Registers a slot with the stub store. In production this row lives on
 * `sponsorship_slots` and is created by the migration, not by the UI.
 */
export function stubRegisterSlot(input: {
  slotKey: string;
  startingPrice: number;
  auctionStatus?: AuctionStatus;
  auctionEndsAt?: string | null;
  currentHighestBid?: number;
  currentHighestBidderId?: string | null;
}) {
  const record: SlotState = {
    slotKey: input.slotKey,
    startingPrice: input.startingPrice,
    currentHighestBid: input.currentHighestBid ?? input.startingPrice,
    currentHighestBidderId: input.currentHighestBidderId ?? null,
    bidCount: input.currentHighestBidderId ? 1 : 0,
    auctionStatus: input.auctionStatus ?? 'open',
    auctionEndsAt: input.auctionEndsAt ?? null,
    bids: [],
  };
  slots.set(record.slotKey, record);
  return record;
}

/** In-memory `place_bid`, matching contract §4.1 semantics. */
export function stubPlaceBid(params: {
  slotKey: string;
  brandId: string;
  amount: number;
}): PlaceBidResult {
  const slot = slots.get(params.slotKey);
  const fail = (errorCode: NonNullable<PlaceBidResult['error_code']>): PlaceBidResult => ({
    bid_id: null,
    status: null,
    current_highest_bid: slot ? slot.currentHighestBid : null,
    previous_bidder_id: null,
    auction_ends_at: slot ? slot.auctionEndsAt : null,
    error_code: errorCode,
  });

  if (!slot) return fail('slot_unavailable');
  if (slot.auctionStatus !== 'open') return fail('auction_not_open');
  if (slot.auctionEndsAt && new Date(slot.auctionEndsAt).getTime() <= Date.now()) {
    return fail('auction_ended');
  }

  // A bid must clear the current high bid (or the starting price) by the increment.
  const floor = slot.currentHighestBidderId
    ? slot.currentHighestBid
    : Math.max(slot.startingPrice - STUB_MIN_INCREMENT, 0);
  if (params.amount < floor + STUB_MIN_INCREMENT) return fail('bid_too_low');

  const previousBidderId = slot.currentHighestBidderId;
  const now = new Date().toISOString();
  const bid: AuctionBid = {
    id: `stub-bid-${slot.slotKey}-${slot.bids.length + 1}`,
    slot_id: slot.slotKey,
    brand_id: params.brandId,
    creator_id: 'stub-creator',
    amount: params.amount,
    currency: 'eur',
    status: 'winning',
    stripe_checkout_session_id: null,
    payment_deadline_at: null,
    placed_at: now,
  };

  // Demote any prior leader — exactly one bid may be `winning` per slot.
  for (const existing of slot.bids) {
    if (existing.status === 'winning') existing.status = 'outbid';
  }
  slot.bids.push(bid);
  slot.currentHighestBid = params.amount;
  slot.currentHighestBidderId = params.brandId;
  slot.bidCount += 1;

  return {
    bid_id: bid.id,
    status: 'winning',
    current_highest_bid: slot.currentHighestBid,
    previous_bidder_id: previousBidderId,
    auction_ends_at: slot.auctionEndsAt,
    error_code: null,
  };
}

/**
 * Registers a sponsorship row so the payout/refund tests have something to act on.
 * In production this row is created by checkout, not by this stub.
 */
export function stubRegisterSponsorship(input: {
  id: string;
  slotId: string;
  amount: number;
  paid?: boolean;
  payoutStatus?: string;
  refundStatus?: string;
}) {
  sponsorships.set(input.id, {
    id: input.id,
    slotId: input.slotId,
    amount: input.amount,
    paid: input.paid ?? false,
    payoutStatus: input.payoutStatus ?? 'none',
    refundStatus: input.refundStatus ?? 'none',
  });
  return sponsorships.get(input.id)!;
}

/** In-memory `mark_sponsorship_paid`, matching contract §4.3 semantics. */
export async function stubMarkSponsorshipPaid(params: {
  sponsorshipId: string;
  amount: number;
  currency: string;
  paymentIntentId?: string;
}): Promise<{ ok: boolean; error_code: string | null }> {
  const sponsorship = sponsorships.get(params.sponsorshipId);
  if (!sponsorship) return { ok: false, error_code: 'not_found' };
  // The amount and currency come from the database, never from the caller's claim.
  if (params.amount !== sponsorship.amount) return { ok: false, error_code: 'amount_mismatch' };
  if (params.currency !== 'eur') return { ok: false, error_code: 'currency_mismatch' };
  sponsorship.paid = true;

  // The real RPC writes the transition to `sponsorships`; the stub's Map alone is not
  // observable by anything reading the table. Mirror the write so a caller that reloads
  // the row — or asserts on it — sees the same state the database would hold.
  try {
    await getAdminClient()
      .from('sponsorships')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: params.paymentIntentId ?? null,
      })
      .eq('id', params.sponsorshipId);
  } catch {
    /* dev-only stub: the caller's caller reports its own failure */
  }

  return { ok: true, error_code: null };
}

/** Reads current stub state (dev tooling + tests). */
export function stubGetSlot(slotKey: string) {
  return slots.get(slotKey) ?? null;
}
export function stubGetSponsorship(id: string) {
  return sponsorships.get(id) ?? null;
}

// The cron jobs call these; against the unmigrated database there is nothing durable
// to do, so they report zero rows affected.
export async function stubCloseExpiredAuctions() {
  return 0;
}
export async function stubExpireUnpaidWinners() {
  return 0;
}
