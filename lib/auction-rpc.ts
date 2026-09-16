/**
 * Auction RPC dispatch layer.
 *
 * ️ PARTIALLY TEMPORARY. See `docs/auction-implementation-contract.md`.
 *
 * This is the seam between the application and Engineer A's database functions. While
 * those functions do not exist yet, calls fall back to the in-memory implementation in
 * `lib/auction-rpc-stubs.ts`. When the migration merges, delete the stubs and keep only
 * the real `.rpc(...)` calls — the rest of the application never has to change.
 *
 * Detection is by PostgREST's "function not found" code (`PGRST202`): against a migrated
 * database the real function wins; against an old one we degrade to the stub rather than
 * 500ing the whole auction UI.
 */

import { getAdminClient } from '@/lib/server-supabase';
import type {
  AuctionBid,
  PlaceBidResult,
} from '@/lib/auction-types';
import {
  stubPlaceBid,
  stubMarkSponsorshipPaid,
  stubCloseExpiredAuctions,
  stubExpireUnpaidWinners,
} from '@/lib/auction-rpc-stubs';

/** PostgREST error code for "function not found". */
const RPC_NOT_FOUND = 'PGRST202';

/**
 * True when a Supabase error means "the RPC does not exist yet".
 * Used only to decide whether to fall back to the dev stub.
 */
function isRpcMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (code === RPC_NOT_FOUND) return true;
  // Some hosts surface the hint instead of the code.
  const message = String((error as { message?: string }).message ?? '');
  return /Could not find the function|does not exist/i.test(message);
}

/**
 * Places a bid by calling the `place_bid` RPC (contract §4.1).
 *
 * The client supplies only the slot id, the brand profile id, and the amount in minor
 * units. Currency, status, and all winner bookkeeping are decided server-side.
 */
export async function placeBid(params: {
  slotId: string;
  brandProfileId: string;
  amount: number;
}): Promise<PlaceBidResult> {
  try {
    const { data, error } = await getAdminClient().rpc('place_bid', {
      p_slot_id: params.slotId,
      p_brand_id: params.brandProfileId,
      p_amount: params.amount,
    });

    if (error) throw error;
    return data as PlaceBidResult;
  } catch (error) {
    if (!isRpcMissing(error)) throw error;

    return stubPlaceBid({
      slotKey: params.slotId,
      brandId: params.brandProfileId,
      amount: params.amount,
    });
  }
}

/**
 * Marks a sponsorship paid (contract §4.3).
 *
 * Called only from the webhook handler after Stripe confirms the payment. The amount and
 * currency are read from the database by the caller and passed back in as an assertion —
 * the RPC re-checks them — so a mismatch is caught rather than silently recorded.
 */
export async function markSponsorshipPaid(params: {
  sponsorshipId: string;
  amount: number;
  currency: string;
  paymentIntentId: string;
}): Promise<{ ok: boolean; error_code: string | null }> {
  try {
    const { data, error } = await getAdminClient().rpc('mark_sponsorship_paid', {
      p_sponsorship_id: params.sponsorshipId,
      p_amount: params.amount,
      p_currency: params.currency,
      p_payment_intent_id: params.paymentIntentId,
    });

    if (error) throw error;
    return (data ?? { ok: false, error_code: 'no_result' }) as {
      ok: boolean;
      error_code: string | null;
    };
  } catch (error) {
    if (!isRpcMissing(error)) throw error;

    return stubMarkSponsorshipPaid({
      sponsorshipId: params.sponsorshipId,
      amount: params.amount,
      currency: params.currency,
    });
  }
}

/**
 * Closes auctions whose end time has passed (contract §4.2).
 * Returns the number of slots transitioned.
 */
export async function closeExpiredAuctions(): Promise<number> {
  try {
    const { data, error } = await getAdminClient().rpc('close_expired_auctions');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  } catch (error) {
    if (!isRpcMissing(error)) throw error;
    return stubCloseExpiredAuctions();
  }
}

/**
 * Expires winning bids whose payment deadline passed without payment, advancing to the
 * next bidder (contract §4.2). Returns the number of winners expired.
 */
export async function expireUnpaidWinners(): Promise<number> {
  try {
    const { data, error } = await getAdminClient().rpc('expire_unpaid_winners');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  } catch (error) {
    if (!isRpcMissing(error)) throw error;
    return stubExpireUnpaidWinners();
  }
}

/**
 * Loads the bids for a slot in descending amount order, for the creator's auction view
 * and for admin oversight. Exposed here (not in the browser) so losing brand identities
 * stay server-side.
 */
export async function loadBidsForSlot(slotId: string): Promise<AuctionBid[]> {
  const { data, error } = await getAdminClient()
    .from('auction_bids')
    .select('*')
    .eq('slot_id', slotId)
    .order('amount', { ascending: false });

  if (error || !data) return [];
  return data as AuctionBid[];
}
