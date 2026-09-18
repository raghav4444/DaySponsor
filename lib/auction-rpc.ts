/**
 * Auction RPC dispatch layer.
 *
 * Thin seam between the application and Engineer A's database functions
 * (`supabase/migrations/20260916*`, documented in
 * `docs/auction-implementation-contract.md`).
 *
 * Auth model (migration 20260916000008):
 *  - `place_bid`, `open_auction`, `advance_fulfillment`, `submit_review` run as the
 *    *authenticated caller* — the RPC derives the brand/creator from `auth.uid()`.
 *    Call them through the caller's token (`createAuthenticatedSupabaseClient`).
 *  - `close_expired_auction`, `expire_unpaid_winner`, `mark_sponsorship_paid`,
 *    `record_refund`, `release_payout` are service-role-only. Call them through the
 *    admin client from a guarded server context (cron secret / webhook signature).
 */

import { createAuthenticatedSupabaseClient } from '@/lib/supabase';
import { getAdminClient } from '@/lib/server-supabase';
import type {
  AuctionBid,
  PlaceBidResult,
} from '@/lib/auction-types';

/**
 * Places a bid via `place_bid(p_slot_id, p_amount)`.
 *
 * The RPC derives the brand from `auth.uid()` — the caller never supplies a brand id
 * and never supplies a currency. Must be called with the brand's token.
 */
export async function placeBid(
  token: string,
  params: {
    slotId: string;
    amount: number;
  },
): Promise<PlaceBidResult> {
  const { data, error } = await createAuthenticatedSupabaseClient(token).rpc('place_bid', {
    p_slot_id: params.slotId,
    p_amount: params.amount,
  });

  if (error) throw error;
  return data as unknown as PlaceBidResult;
}

/**
 * Opens a draft auction (`open_auction`). Only the Day's creator may call it.
 * Must be called with the creator's token.
 */
export async function openAuction(
  token: string,
  params: {
    slotId: string;
    startingPrice: number;
    currency: string;
    endsAt: string;
  },
) {
  const { data, error } = await createAuthenticatedSupabaseClient(token).rpc('open_auction', {
    p_slot_id: params.slotId,
    p_starting_price: params.startingPrice,
    p_currency: params.currency,
    p_ends_at: params.endsAt,
  });

  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

/**
 * Advances fulfillment (`advance_fulfillment`). Caller must be the brand or the
 * creator, and only the entitled party per edge. Called with the caller's token.
 */
export async function advanceFulfillment(
  token: string,
  params: { sponsorshipId: string; toStatus: string },
) {
  const { data, error } = await createAuthenticatedSupabaseClient(token).rpc(
    'advance_fulfillment',
    {
      p_sponsorship_id: params.sponsorshipId,
      p_to_status: params.toStatus,
    },
  );

  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

/**
 * Submits a creator review (`submit_review`). The reviewed brand is derived from the
 * winning bid inside the RPC. Called with the creator's token.
 */
export async function submitReview(
  token: string,
  params: {
    sponsorshipId: string;
    rating: number;
    title: string | null;
    content: string | null;
    pros: string[];
    cons: string[];
    wouldRecommend: boolean | null;
    videoUrl: string | null;
    videoPlatform: string | null;
  },
) {
  const { data, error } = await createAuthenticatedSupabaseClient(token).rpc('submit_review', {
    p_sponsorship_id: params.sponsorshipId,
    p_rating: params.rating,
    p_title: params.title,
    p_content: params.content,
    p_pros: params.pros,
    p_cons: params.cons,
    p_would_recommend: params.wouldRecommend,
    p_video_url: params.videoUrl,
    p_video_platform: params.videoPlatform,
  });

  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

// ─── Service-role-only RPCs (scheduler / webhook) ─────────────────────────────

/**
 * Settles one ended auction (`close_expired_auction(p_slot_id)`).
 * Service role only — call from a cron-guarded server context.
 */
export async function closeExpiredAuction(slotId: string) {
  const { data, error } = await getAdminClient().rpc('close_expired_auction', {
    p_slot_id: slotId,
  });

  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

/**
 * Falls back one unpaid winner (`expire_unpaid_winner(p_slot_id, p_max_attempts)`).
 * Service role only — call from a cron-guarded server context.
 */
export async function expireUnpaidWinner(slotId: string, maxAttempts: number) {
  const { data, error } = await getAdminClient().rpc('expire_unpaid_winner', {
    p_slot_id: slotId,
    p_max_attempts: maxAttempts,
  });

  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

/**
 * Marks a sponsorship paid (`mark_sponsorship_paid`). Called only from the webhook
 * handler after Stripe confirms the payment. Service role only.
 */
export async function markSponsorshipPaid(params: {
  sponsorshipId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
}): Promise<{ ok: boolean; error: string | null } & Record<string, unknown>> {
  const { data, error } = await getAdminClient().rpc('mark_sponsorship_paid', {
    p_sponsorship_id: params.sponsorshipId,
    p_payment_intent_id: params.paymentIntentId,
    p_charge_id: params.chargeId,
  });

  if (error) throw error;
  return (data ?? { ok: false, error: 'no_result' }) as {
    ok: boolean;
    error: string | null;
  } & Record<string, unknown>;
}

/**
 * Records a refund (`record_refund`). Called only from the webhook handler.
 * Service role only.
 */
export async function recordRefund(params: {
  sponsorshipId: string;
  refundId: string;
  amount: number;
}) {
  const { data, error } = await getAdminClient().rpc('record_refund', {
    p_sponsorship_id: params.sponsorshipId,
    p_refund_id: params.refundId,
    p_amount: params.amount,
  });

  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

/**
 * Releases a payout (`release_payout`). Called after the Stripe transfer exists.
 * Service role only.
 */
export async function releasePayoutRpc(params: {
  sponsorshipId: string;
  transferId: string;
}) {
  const { data, error } = await getAdminClient().rpc('release_payout', {
    p_sponsorship_id: params.sponsorshipId,
    p_transfer_id: params.transferId,
  });

  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

/**
 * Loads the bids for a slot in descending amount order, for the creator's auction view
 * and for admin oversight. Exposed here (not in the browser) so losing brand identities
 * stay server-side.
 */
export async function loadBidsForSlot(slotId: string): Promise<AuctionBid[]> {
  const { data, error } = await getAdminClient()
    .from('bids')
    .select('*')
    .eq('slot_id', slotId)
    .order('amount', { ascending: false })
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data as AuctionBid[];
}
