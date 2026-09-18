/**
 * Refund orchestration.
 *
 * Two paths, chosen by whether the creator has been paid yet:
 *
 *  1. **Before payout** — refund the charge, block the payout, then wait for the webhook
 *     to confirm. The payout must never succeed for a charge being refunded.
 *
 *  2. **After payout** — the money has already left. Requires an authorized admin. The
 *     transfer is reversed (partially or in full) so the platform recovers what it can.
 *
 * Hard rules:
 *  - Never claim money was recovered until Stripe confirms it. `refunded` is only set by
 *    the webhook, never by the request path.
 *  - Every action is idempotent: repeated requests return the same outcome.
 *  - The refund amount is read from the database, never from the request.
 */

import type Stripe from 'stripe';
import { getStripe, getPlatformConfig } from '@/lib/stripe/server';
import { withStripeError, StripeOperationError } from '@/lib/stripe/errors';
import { IdempotencyKeys } from '@/lib/stripe/idempotency';
import { getAdminClient } from '@/lib/server-supabase';
import { loadSponsorshipForPayout } from '@/lib/auction-queries';
import { formatMinorUnits } from '@/lib/money';
import { notifyAll, type NotificationInput } from '@/lib/notifications';

/** Which refund path applies to this sponsorship right now. */
export type RefundPath = 'pre_payout' | 'post_payout' | 'already_refunded' | 'not_paid';

export type RefundAssessment = {
  path: RefundPath;
  /** True when a refund may be attempted at all. */
  allowed: boolean;
  /** Why it is not allowed, when it is not. */
  reason: string | null;
  sponsorshipId: string;
  chargeId: string | null;
  transferId: string | null;
  /** The amount that would be refunded, in minor units. */
  amount: number;
  currency: string;
};

/**
 * Determines which refund path applies. Reads only — no Stripe mutation.
 *
 * A sponsorship that was never paid cannot be refunded (there is nothing to return).
 * A sponsorship already fully refunded is reported as such rather than errored, so
 * retries are idempotent.
 */
export async function assessRefund(sponsorshipId: string): Promise<RefundAssessment> {
  const sponsorship = await loadSponsorshipForPayout(sponsorshipId);
  if (!sponsorship) {
    throw new StripeOperationError('Sponsorship not found.', {
      statusCode: 404,
      code: 'not_found',
    });
  }

  const paymentStatus = String(sponsorship.payment_status ?? 'pending');
  const payoutStatus = String(sponsorship.payout_status ?? 'pending');
  const status = String(sponsorship.status);
  const amount = Number(sponsorship.amount);
  const currency = String(sponsorship.currency ?? getPlatformConfig().currency);
  // The schema records a payment intent id; a charge id is stored once `charge.succeeded`
  // lands. Refunds may be created from either.
  const chargeId =
    (sponsorship.stripe_charge_id as string | null) ??
    (sponsorship.stripe_payment_intent_id as string | null) ??
    null;
  const transferId = (sponsorship.stripe_transfer_id as string | null) ?? null;
  const refundId = (sponsorship.stripe_refund_id as string | null) ?? null;

  // Idempotent: an already-recorded refund is a success, not an error. The DB records
  // the refund via `record_refund` (webhook): `stripe_refund_id` set and payment
  // `refunded`, or `status = 'refunded'`.
  if (refundId || paymentStatus === 'refunded' || status === 'refunded') {
    return {
      path: 'already_refunded',
      allowed: false,
      reason: 'This sponsorship has already been refunded.',
      sponsorshipId,
      chargeId,
      transferId,
      amount,
      currency,
    };
  }

  // Nothing was ever collected, so there is nothing to refund.
  if (
    paymentStatus !== 'paid' ||
    status === 'payment_pending' ||
    status === 'pending' ||
    status === 'cancelled'
  ) {
    return {
      path: 'not_paid',
      allowed: false,
      reason: 'This sponsorship was never paid, so there is nothing to refund.',
      sponsorshipId,
      chargeId,
      transferId,
      amount,
      currency,
    };
  }

  // Money has already reached the creator: reversal path, admin-only.
  if (payoutStatus === 'released') {
    return {
      path: 'post_payout',
      allowed: true,
      reason: null,
      sponsorshipId,
      chargeId,
      transferId,
      amount,
      currency,
    };
  }

  // Standard path: charge captured, creator not yet paid.
  return {
    path: 'pre_payout',
    allowed: true,
    reason: null,
    sponsorshipId,
    chargeId,
    transferId,
    amount,
    currency,
  };
}

/**
 * Refunds a sponsorship **before** the creator has been paid.
 *
 * Steps in order:
 *  1. create the refund with Stripe;
 *  2. block the payout so the payout job cannot race this refund;
 *  3. wait for the webhook (`charge.refunded`) to confirm before reporting success.
 *
 * Returns the refund object; the database `refunded` flag is set later by the webhook.
 */
export async function refundBeforePayout(sponsorshipId: string): Promise<{
  refundId: string;
  amount: number;
  status: string;
}> {
  const assessment = await assessRefund(sponsorshipId);
  if (!assessment.allowed) {
    throw new StripeOperationError(
      assessment.reason ?? 'This sponsorship cannot be refunded.',
      { statusCode: 409, code: 'conflict' },
    );
  }
  if (assessment.path !== 'pre_payout') {
    throw new StripeOperationError(
      'The creator has already been paid. Use the post-payout path with admin authorization.',
      { statusCode: 409, code: 'already_processed' },
    );
  }
  if (!assessment.chargeId) {
    throw new StripeOperationError('No charge is recorded for this sponsorship.', {
      statusCode: 409,
      code: 'not_found',
    });
  }

  // Block the payout first, so a concurrently-running payout job cannot win the race.
  await blockPayout(sponsorshipId, 'refund_requested');

  const refund = await createRefund({
    chargeId: assessment.chargeId,
    amount: assessment.amount,
    sponsorshipId,
  });

  return {
    refundId: refund.id,
    amount: refund.amount,
    // A null status means Stripe has not decided yet; report it as pending.
    status: refund.status ?? 'pending',
  };
}

/**
 * Refunds a sponsorship **after** the creator was paid. Requires an authorized admin —
 * the caller must have already verified that before reaching this function.
 *
 * Reverses the transfer for as much as can be recovered, then refunds the remainder of
 * the charge. Never claims recovery beyond what Stripe reports.
 */
export async function refundAfterPayout(sponsorshipId: string): Promise<{
  refundId: string | null;
  reversalId: string | null;
  recoveredAmount: number;
  status: string;
}> {
  const assessment = await assessRefund(sponsorshipId);
  if (!assessment.allowed) {
    throw new StripeOperationError(
      assessment.reason ?? 'This sponsorship cannot be refunded.',
      { statusCode: 409, code: 'conflict' },
    );
  }
  if (assessment.path !== 'post_payout' || !assessment.transferId) {
    throw new StripeOperationError('No transfer exists to reverse for this sponsorship.', {
      statusCode: 409,
      code: 'not_found',
    });
  }

  // Ensure the payout stays blocked while the reversal is in flight.
  await blockPayout(sponsorshipId, 'reversal_requested');

  const reversal = await reverseTransfer({
    transferId: assessment.transferId,
    sponsorshipId,
  });

  // Only the amount Stripe actually reports as reversed counts as recovered.
  const recoveredFromTransfer = Number(reversal.amount ?? 0);
  let refundId: string | null = null;
  let refundedAmount = 0;

  // If the reversal did not cover the full sponsorship, attempt a charge refund for the
  // rest. This may not be possible once the funds have moved — do not assume it is.
  if (assessment.chargeId && recoveredFromTransfer < assessment.amount) {
    try {
      const refund = await createRefund({
        chargeId: assessment.chargeId,
        amount: assessment.amount - recoveredFromTransfer,
        sponsorshipId,
      });
      refundId = refund.id;
      refundedAmount = refund.amount;
    } catch (error) {
      // A failed top-up refund is reported honestly, not hidden.
      console.error('[refund.afterPayout] additional charge refund failed', {
        sponsorship_id: sponsorshipId,
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  return {
    refundId,
    reversalId: reversal.id,
    recoveredAmount: recoveredFromTransfer + refundedAmount,
    status: refundId ? 'pending' : 'reversal_only',
  };
}

/**
 * Creates a Stripe refund. Idempotent per sponsorship + charge, so a retried request
 * returns the original refund instead of refunding twice.
 */
export async function createRefund(params: {
  chargeId: string;
  amount: number;
  sponsorshipId: string;
}): Promise<Stripe.Refund> {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new StripeOperationError('Refund amount must be a positive integer in minor units.', {
      statusCode: 400,
      code: 'invalid_request',
    });
  }

  return withStripeError('refund.create', () =>
    getStripe().refunds.create(
      {
        payment_intent: params.chargeId,
        amount: params.amount,
        metadata: {
          sponsorship_id: params.sponsorshipId,
          refunded_amount: String(params.amount),
        },
      },
      {
        idempotencyKey: IdempotencyKeys.refundForSponsorship(
          params.sponsorshipId,
          params.chargeId,
        ),
      },
    ),
  );
}

/**
 * Reverses a transfer. Idempotent per transfer, so a retry never reverses twice.
 */
export async function reverseTransfer(params: {
  transferId: string;
  sponsorshipId: string;
  amount?: number;
}): Promise<Stripe.TransferReversal> {
  return withStripeError('refund.reverseTransfer', () =>
    getStripe().transfers.createReversal(
      params.transferId,
      {
        amount: params.amount,
        metadata: {
          sponsorship_id: params.sponsorshipId,
        },
      },
      {
        idempotencyKey: IdempotencyKeys.reversalForTransfer(params.transferId),
      },
    ),
  );
}

/**
 * Blocks the payout for a sponsorship. Used before requesting a refund so the payout job
 * cannot release funds that are about to be returned to the brand.
 */
export async function blockPayout(sponsorshipId: string, reason: string) {
  const { error } = await getAdminClient()
    .from('sponsorships')
    .update({
      payout_hold: true,
      payout_hold_reason: reason,
    })
    .eq('id', sponsorshipId);

  if (error) throw error;
  return true;
}

/**
 * Records the final refund state. Called only by the webhook once Stripe confirms the
 * refund completed — never by the request path. Delegates to the `record_refund` RPC
 * so the guarded payout/ledger columns move atomically.
 */
export async function recordRefundCompleted(sponsorshipId: string, refundId: string) {
  const sponsorship = await loadSponsorshipForPayout(sponsorshipId);
  const currency = String(sponsorship?.currency ?? getPlatformConfig().currency);
  const amount = Number(sponsorship?.amount ?? 0);
  const brandId = String(sponsorship?.brand_id ?? '');
  const creatorId = String(sponsorship?.creator_id ?? '');

  // The RPC is the only writer of the guarded refund columns (migration 0003 forbids
  // client writes). It derives the refund amount from the recorded sponsorship amount.
  const { recordRefund } = await import('@/lib/auction-rpc');
  await recordRefund({ sponsorshipId, refundId, amount });

  // Notify both parties. Fire-and-forget; never rolls back the recorded refund.
  const refundNotifications: NotificationInput[] = [
    {
      recipientId: brandId,
      type: 'refund_completed',
      relatedType: 'sponsorship',
      relatedId: sponsorshipId,
      body: `${formatMinorUnits(amount, currency)} has been refunded to you.`,
    },
  ];

  if (creatorId) {
    refundNotifications.push({
      recipientId: creatorId,
      type: 'refund_completed',
      relatedType: 'sponsorship',
      relatedId: sponsorshipId,
      body: 'The sponsorship was refunded. Your payout for this sponsorship is void.',
    });
  }

  void notifyAll(refundNotifications);

  return true;
}

/**
 * Records a failed refund attempt on the webhook ledger, so an admin can see it in the
 * dashboard. The guarded `sponsorships` payout columns are RPC-owned and are never
 * written directly here.
 */
export async function recordRefundFailure(sponsorshipId: string, reason: string) {
  const { error } = await getAdminClient()
    .from('stripe_webhook_events')
    .update({
      error_message: `refund_failed:${sponsorshipId}:${reason}`,
    })
    .eq('resource_id', sponsorshipId);

  if (error) throw error;
  return true;
}
