/**
 * Winning-bid Checkout Session orchestration.
 *
 * Implements the contract from the task: the client may send **only** a sponsorship id or
 * a winning bid id. The amount and currency are read from the database and never from the
 * request. This module never marks the sponsorship paid — that happens exclusively in the
 * webhook handler, once Stripe confirms the payment.
 */

import type Stripe from 'stripe';
import { getStripe, getPlatformConfig, getAppUrl } from '@/lib/stripe/server';
import { withStripeError } from '@/lib/stripe/errors';
import { IdempotencyKeys } from '@/lib/stripe/idempotency';
import { isAccountEligibleForTransfers } from '@/lib/stripe/connect';
import { splitPlatformFee } from '@/lib/money';
import {
  loadBidForCheckout,
  loadSlotWithAuction,
  loadOpenSponsorshipForSlot,
  loadSponsorshipById,
  findPendingSponsorshipForBid,
  recordCheckoutSession,
  computePaymentDeadline,
} from '@/lib/auction-queries';
import { getAdminClient } from '@/lib/server-supabase';
import type { AuctionBid } from '@/lib/auction-types';

/** Result of resolving what to pay for. */
export type ResolvedCheckout = {
  sponsorshipId: string;
  bidId: string;
  slotId: string;
  brandProfileId: string;
  creatorProfileId: string;
  stripeAccountId: string;
  amount: number;
  currency: string;
  creatorAmount: number;
  platformFee: number;
};

/**
 * Every precondition that must hold before a Checkout Session is created.
 * Checked in order, most fundamental first.
 */
export class CheckoutValidationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = 'CheckoutValidationError';
  }
}

function reject(code: string, message: string, statusCode = 400): never {
  throw new CheckoutValidationError(message, code, statusCode);
}

/**
 * Resolves a winning bid into a sponsorship + money split, applying every precondition.
 *
 * Accepts either a bid id or a sponsorship id. Amount and currency are read from the
 * database — the caller's claim is never trusted.
 */
export async function resolveCheckout(params: {
  bidId?: string | null;
  sponsorshipId?: string | null;
  brandProfileId: string;
}): Promise<ResolvedCheckout> {
  if (!params.bidId && !params.sponsorshipId) {
    reject('missing_reference', 'A winning bid id or sponsorship id is required.');
  }

  let bid: (AuctionBid & { slot: Awaited<ReturnType<typeof loadSlotWithAuction>> }) | null = null;
  let sponsorshipId = params.sponsorshipId ?? null;

  if (params.bidId) {
    bid = await loadBidForCheckout(params.bidId);
    if (!bid) reject('bid_not_found', 'That bid no longer exists.', 404);
  } else if (sponsorshipId) {
    const sponsorship = await loadSponsorshipById(sponsorshipId);
    if (!sponsorship) {
      reject('sponsorship_not_found', 'That sponsorship does not exist.', 404);
    }
    // The caller must own the sponsorship — a bare id is not an authorization.
    if (sponsorship.brand_id !== params.brandProfileId) {
      reject('not_sponsorship_owner', 'This sponsorship belongs to another brand.', 403);
    }
    const linkedBidId = (sponsorship.winning_bid_id as string | null) ?? null;
    if (!linkedBidId) reject('no_winning_bid', 'This sponsorship has no winning bid yet.', 409);
    bid = await loadBidForCheckout(linkedBidId);
    if (!bid) reject('bid_not_found', 'That bid no longer exists.', 404);
  }

  // 1. Ownership: the bid must belong to the caller.
  if (bid!.brand_id !== params.brandProfileId) {
    reject('not_bid_owner', 'This bid belongs to another brand.', 403);
  }

  // 2. The bid must be the winner — not merely a participant.
  if (bid!.status !== 'winning' && bid!.status !== 'payment_pending') {
    reject('not_winning', 'This bid is not the winning bid.', 409);
  }

  const slot = bid!.slot;
  // 3. The slot must still exist and be available.
  if (!slot) reject('slot_unavailable', 'This slot is no longer available.', 404);
  if (!slot.is_available) reject('slot_taken', 'This slot is no longer available.', 409);

  // 4. The auction must be closed (a winner exists) — an open auction cannot be paid for.
  if (slot.auction_status === 'open') {
    reject('auction_still_open', 'This auction has not closed yet.', 409);
  }

  // 5. Amount comes from the bid row, not the request. Currency likewise.
  const amount = bid!.amount;
  if (!Number.isInteger(amount) || amount <= 0) {
    reject('invalid_amount', 'The bid amount is not valid.', 402);
  }

  // 6. The creator must have a Connect account able to receive transfers.
  const creatorProfileId = bid!.creator_id;
  const stripeAccountId = await loadStripeAccountId(creatorProfileId);
  if (!stripeAccountId) {
    reject(
      'creator_not_connected',
      'The creator has not connected a Stripe account yet.',
      409,
    );
  }
  const eligible = await isAccountEligibleForTransfers(stripeAccountId);
  if (!eligible) {
    reject(
      'creator_not_eligible',
      'The creator has not finished their Stripe onboarding yet.',
      409,
    );
  }

  // 7. No other sponsorship may already be paid for this slot.
  const existing = await loadOpenSponsorshipForSlot(slot!.id);
  if (existing && existing.id !== sponsorshipId && existing.status === 'paid') {
    reject('slot_already_paid', 'This slot has already been sponsored.', 409);
  }

  // 8. Fee split, computed server-side from the platform config.
  const { feeBps } = getPlatformConfig();
  const { platformFee, creatorAmount } = splitPlatformFee(amount, feeBps);
  const currency = bid!.currency || getPlatformConfig().currency;

  // 9. Persist the sponsorship if none exists yet (idempotent). A concurrent retry for
  //    the same bid must reuse the row created by the first attempt, never duplicate it.
  if (!sponsorshipId) {
    const existing = await findPendingSponsorshipForBid(bid!.id, slot!.id);
    if (existing) {
      sponsorshipId = existing.id;
    } else {
      sponsorshipId = await createPendingSponsorship({
        slotId: slot!.id,
        brandProfileId: bid!.brand_id,
        creatorProfileId,
        bidId: bid!.id,
        amount,
        currency,
        platformFee,
        creatorAmount,
      });
    }
  } else {
    // Reuse the existing pending row, and re-record the winning bid link if missing.
    await linkWinningBid(sponsorshipId, bid!.id);
  }

  return {
    // Non-null by this point: either supplied and verified, or just created above.
    sponsorshipId: sponsorshipId as string,
    bidId: bid!.id,
    slotId: slot!.id,
    brandProfileId: bid!.brand_id,
    creatorProfileId,
    // Non-null after the eligibility checks above; the assertion documents the invariant.
    stripeAccountId: stripeAccountId as string,
    amount,
    currency,
    creatorAmount,
    platformFee,
  };
}

/**
 * Creates the Stripe Checkout Session.
 *
 * Money is charged to the platform and routed to the creator with a **delayed separate
 * transfer** (contract §2 / payout phase), never a destination charge. The transfer
 * group ties the charge to the later transfer.
 */
export async function createCheckoutSession(
  resolved: ResolvedCheckout,
  options: { idempotencyToken?: string } = {},
): Promise<Stripe.Checkout.Session> {
  const appUrl = getAppUrl();
  const { currency } = resolved;

  return withStripeError('checkout.createSession', () =>
    getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        // The amount is read from the database, never from the client.
        line_items: [
          {
            price_data: {
              currency,
              unit_amount: resolved.amount,
              product_data: {
                name: 'Day sponsorship — winning bid',
                metadata: {
                  sponsorship_id: resolved.sponsorshipId,
                  slot_id: resolved.slotId,
                  winning_bid_id: resolved.bidId,
                },
              },
            },
            quantity: 1,
          },
        ],
        // Delayed separate transfer: the platform takes the charge now, and the transfer
        // to the creator is issued later by the payout job once it is earned.
        payment_intent_data: {
          capture_method: 'automatic',
          transfer_group: `sponsorship_${resolved.sponsorshipId}`,
          metadata: {
            sponsorship_id: resolved.sponsorshipId,
            slot_id: resolved.slotId,
            winning_bid_id: resolved.bidId,
            creator_profile_id: resolved.creatorProfileId,
            brand_profile_id: resolved.brandProfileId,
            creator_amount: String(resolved.creatorAmount),
            platform_fee: String(resolved.platformFee),
          },
        },
        metadata: {
          sponsorship_id: resolved.sponsorshipId,
          slot_id: resolved.slotId,
          winning_bid_id: resolved.bidId,
          creator_profile_id: resolved.creatorProfileId,
        },
        success_url: `${appUrl}/dashboard/brand?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/dashboard/brand?payment=cancelled`,
        // The browser redirect is decorative — the webhook is the source of truth — but a
        // session still lapses if it is abandoned, so the window stays bounded.
        expires_at: Math.floor((Date.now() + 30 * 60 * 1000) / 1000),
      },
      {
        // One session per sponsorship+token, so a retry returns the same session.
        idempotencyKey: IdempotencyKeys.checkoutSession(
          resolved.sponsorshipId,
          options.idempotencyToken ?? 'default',
        ),
      },
    ),
  );
}

/**
 * Records the created session against the sponsorship and returns the client secret-ish
 * reference the browser actually needs: just the session URL/id. Never a secret key.
 */
export async function persistCheckoutSession(
  resolved: ResolvedCheckout,
  session: Stripe.Checkout.Session,
) {
  await recordCheckoutSession(
    resolved.sponsorshipId,
    session.id,
    typeof session.payment_intent === 'string' ? session.payment_intent : null,
    computePaymentDeadline(),
  );
  return { url: session.url, sessionId: session.id };
}

// --- helpers ---------------------------------------------------------------

async function loadSponsorshipSlotId(sponsorshipId: string): Promise<string | null> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('id, slot_id')
    .eq('id', sponsorshipId)
    .maybeSingle();
  if (error || !data) return null;
  return data.slot_id as string;
}

async function loadStripeAccountId(creatorProfileId: string): Promise<string | null> {
  const { data, error } = await getAdminClient()
    .from('creator_profiles')
    .select('stripe_account_id')
    .eq('id', creatorProfileId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.stripe_account_id as string | null) ?? null;
}

async function createPendingSponsorship(params: {
  slotId: string;
  brandProfileId: string;
  creatorProfileId: string;
  bidId: string;
  amount: number;
  currency: string;
  platformFee: number;
  creatorAmount: number;
}): Promise<string> {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .insert({
      slot_id: params.slotId,
      brand_id: params.brandProfileId,
      creator_id: params.creatorProfileId,
      winning_bid_id: params.bidId,
      amount: params.amount,
      currency: params.currency,
      platform_fee: params.platformFee,
      creator_amount: params.creatorAmount,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !data) {
    reject('sponsorship_not_created', 'Could not create the sponsorship record.', 500);
  }
  return data.id as string;
}

async function linkWinningBid(sponsorshipId: string, bidId: string) {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .update({ winning_bid_id: bidId })
    .eq('id', sponsorshipId)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    reject('sponsorship_not_updated', 'Could not update the sponsorship record.', 500);
  }
}

export { findPendingSponsorshipForBid };
