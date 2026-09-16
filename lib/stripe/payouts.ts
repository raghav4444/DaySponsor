/**
 * Payout (creator payout) orchestration.
 *
 * Hard rules this module enforces:
 *  - Payout is released only when all eight preconditions hold.
 *  - The transfer is for **exactly** `creator_amount` — never the charge amount, never a
 *    recomputed value, and never anything derived from the review rating.
 *  - A 1-star review and a 5-star review must produce the same payout.
 *  - The transfer is a *delayed separate transfer* from the platform charge, tied by
 *    `transfer_group`; never a destination charge.
 *  - Money is only marked paid once Stripe confirms the transfer succeeded.
 */

import type Stripe from 'stripe';
import { getStripe, getPlatformConfig } from '@/lib/stripe/server';
import { withStripeError, StripeOperationError } from '@/lib/stripe/errors';
import { IdempotencyKeys } from '@/lib/stripe/idempotency';
import { isAccountEligibleForTransfers } from '@/lib/stripe/connect';
import { getAdminClient } from '@/lib/server-supabase';
import { loadSponsorshipForPayout } from '@/lib/auction-queries';
import { formatMinorUnits } from '@/lib/money';
import { notify } from '@/lib/notifications';

/** Every precondition checked before a transfer is issued. */
export const PAYOUT_PRECONDITIONS = [
  'sponsorship_exists',
  'sponsorship_paid',
  'not_refunded',
  'not_already_paid_out',
  'not_on_hold',
  'creator_connected_and_eligible',
  'charge_succeeded',
  'creator_amount_positive',
] as const;

export type PayoutPrecondition = (typeof PAYOUT_PRECONDITIONS)[number];

export type PayoutCheck = {
  precondition: PayoutPrecondition;
  ok: boolean;
  /** Human-readable reason, surfaced to admins and logged (never secrets). */
  reason: string | null;
};

export type PayoutValidation = {
  ok: boolean;
  checks: PayoutCheck[];
  /** The first failed precondition, if any. */
  blocking: PayoutPrecondition | null;
};

/**
 * Evaluates all eight payout preconditions for a sponsorship.
 *
 * Pure with respect to Stripe writes: it reads only. This separation matters — the cron
 * job and the admin dashboard both call this to decide *whether* to pay, and then only
 * the release path issues a transfer.
 *
 * Note that the review is **not** consulted anywhere. The review rating never gates or
 * changes the payout amount.
 */
export async function validatePayout(sponsorshipId: string): Promise<PayoutValidation> {
  const sponsorship = await loadSponsorshipForPayout(sponsorshipId);

  const fail = (
    precondition: PayoutPrecondition,
    reason: string,
    priorChecks: PayoutCheck[] = [],
  ): PayoutValidation => ({
    ok: false,
    checks: [...priorChecks, { precondition, ok: false, reason }],
    blocking: precondition,
  });

  // 1. The sponsorship row must exist.
  if (!sponsorship) {
    return fail('sponsorship_exists', 'Sponsorship record not found.');
  }

  // 2. The brand must actually have paid. Unpaid sponsorships are never paid out.
  if (sponsorship.status !== 'paid' && sponsorship.status !== 'product_shipped'
      && sponsorship.status !== 'product_received' && sponsorship.status !== 'day_completed'
      && sponsorship.status !== 'review_pending' && sponsorship.status !== 'completed') {
    return fail(
      'sponsorship_paid',
      `Sponsorship status is '${sponsorship.status}', so payment has not been confirmed.`,
    );
  }

  const checks: PayoutCheck[] = [
    { precondition: 'sponsorship_exists', ok: true, reason: null },
    { precondition: 'sponsorship_paid', ok: true, reason: null },
  ];

  // 3. A refunded sponsorship is never paid out.
  const refundStatus = (sponsorship.refund_status as string | null) ?? 'none';
  if (refundStatus === 'completed' || refundStatus === 'pending') {
    return fail(
      'not_refunded',
      `Refund is '${refundStatus}', so no payout can be released.`,
      checks,
    );
  }
  checks.push({ precondition: 'not_refunded', ok: true, reason: null });

  // 4. Idempotency guard: an already-released payout is not re-issued.
  const payoutStatus = (sponsorship.payout_status as string | null) ?? 'none';
  if (payoutStatus === 'released' || payoutStatus === 'pending') {
    return fail(
      'not_already_paid_out',
      `Payout is already '${payoutStatus}'.`,
      checks,
    );
  }
  checks.push({ precondition: 'not_already_paid_out', ok: true, reason: null });

  // 5. An explicit hold (dispute, review, manual admin action) blocks the payout.
  const hold = sponsorship.payout_hold as boolean | null;
  if (hold) {
    return fail(
      'not_on_hold',
      String(sponsorship.payout_hold_reason ?? 'Payout is on hold pending review.'),
      checks,
    );
  }
  checks.push({ precondition: 'not_on_hold', ok: true, reason: null });

  // 6. The creator must still be able to receive transfers.
  const stripeAccountId = (sponsorship.stripe_transfer_id as string | null)
    ?? (await loadCreatorAccountId(sponsorship.creator_id as string));
  if (!stripeAccountId) {
    return fail(
      'creator_connected_and_eligible',
      'The creator has no connected Stripe account.',
      checks,
    );
  }
  const eligible = await isAccountEligibleForTransfers(stripeAccountId);
  if (!eligible) {
    return fail(
      'creator_connected_and_eligible',
      'The creator’s Stripe account cannot receive transfers right now.',
      checks,
    );
  }
  checks.push({ precondition: 'creator_connected_and_eligible', ok: true, reason: null });

  // 7. The underlying charge must have succeeded — a pending or failed charge has no
  //    money to transfer.
  const paymentIntentId = sponsorship.stripe_payment_intent_id as string | null;
  if (!paymentIntentId) {
    return fail('charge_succeeded', 'No payment intent is recorded for this sponsorship.', checks);
  }
  const chargeOk = await verifyChargeSucceeded(paymentIntentId);
  if (!chargeOk) {
    return fail(
      'charge_succeeded',
      'The charge has not succeeded yet, so there is nothing to transfer.',
      checks,
    );
  }
  checks.push({ precondition: 'charge_succeeded', ok: true, reason: null });

  // 8. There must be something to pay.
  const creatorAmount = sponsorship.creator_amount as number;
  if (!Number.isInteger(creatorAmount) || creatorAmount <= 0) {
    return fail(
      'creator_amount_positive',
      'The recorded creator amount is not a positive integer.',
      checks,
    );
  }

  return {
    ok: true,
    checks: [
      ...checks,
      { precondition: 'creator_amount_positive', ok: true, reason: null },
    ],
    blocking: null,
  };
}

/**
 * Releases the creator payout as a delayed separate transfer.
 *
 * Transfers exactly `creator_amount` — never the gross charge, never a value recomputed
 * from the review or any other signal.
 */
export async function releasePayout(sponsorshipId: string): Promise<{
  transferred: boolean;
  transferId: string | null;
  validation: PayoutValidation;
}> {
  const validation = await validatePayout(sponsorshipId);
  if (!validation.ok) return { transferred: false, transferId: null, validation };

  const sponsorship = (await loadSponsorshipForPayout(sponsorshipId))!;
  const creatorAmount = sponsorship.creator_amount as number;

  // The destination is always the creator's Connect account id. The transfer *id*
  // (`stripe_transfer_id`) is a different thing entirely and must never be used as a
  // destination — validation guarantees an account exists and is eligible.
  const destination = await loadCreatorAccountId(sponsorship.creator_id as string);
  if (!destination) {
    return {
      transferred: false,
      transferId: null,
      validation: {
        ok: false,
        checks: [],
        blocking: 'creator_connected_and_eligible',
      },
    };
  }

  const transfer = await createTransfer({
    amount: creatorAmount,
    currency: String(sponsorship.currency ?? getPlatformConfig().currency),
    destination: destination!,
    transferGroup: `sponsorship_${sponsorshipId}`,
    sponsorshipId,
  });

  await recordTransfer(sponsorshipId, transfer.id);

  // Notify the creator. Fire-and-forget — never rolls back the transfer.
  const currency = String(sponsorship.currency ?? getPlatformConfig().currency);
  void notify({
    recipientId: sponsorship.creator_id as string,
    type: 'payout_released',
    relatedType: 'sponsorship',
    relatedId: sponsorshipId,
    body: `${formatMinorUnits(creatorAmount, currency)} has been sent to your Stripe account.`,
  });

  return { transferred: true, transferId: transfer.id, validation };
}

/**
 * Creates the delayed separate transfer. Platform charge → separate transfer, tied by
 * transfer group. Idempotent per sponsorship, so a retry cannot pay the creator twice.
 */
export async function createTransfer(params: {
  amount: number;
  currency: string;
  destination: string;
  transferGroup: string;
  sponsorshipId: string;
}): Promise<Stripe.Transfer> {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new StripeOperationError('Transfer amount must be a positive integer in minor units.', {
      statusCode: 400,
      code: 'invalid_request',
    });
  }

  return withStripeError('payout.createTransfer', () =>
    getStripe().transfers.create(
      {
        amount: params.amount,
        currency: params.currency,
        destination: params.destination,
        transfer_group: params.transferGroup,
        metadata: {
          sponsorship_id: params.sponsorshipId,
          // Records exactly what was transferred, for later reconciliation.
          transferred_creator_amount: String(params.amount),
        },
      },
      { idempotencyKey: IdempotencyKeys.transferForSponsorship(params.sponsorshipId) },
    ),
  );
}

/**
 * Verifies the underlying charge succeeded before a transfer is issued.
 * Reads the payment intent from Stripe — the database status alone is not authoritative.
 */
export async function verifyChargeSucceeded(paymentIntentId: string): Promise<boolean> {
  try {
    const intent = await withStripeError('payout.retrievePaymentIntent', () =>
      getStripe().paymentIntents.retrieve(paymentIntentId),
    );
    return intent.status === 'succeeded';
  } catch {
    // If the intent cannot be read, do not pay out on assumption.
    return false;
  }
}

/**
 * Records a successful transfer against the sponsorship.
 * Called only after Stripe confirms the transfer object exists.
 */
export async function recordTransfer(sponsorshipId: string, transferId: string) {
  const { error } = await getAdminClient()
    .from('sponsorships')
    .update({
      stripe_transfer_id: transferId,
      payout_status: 'released',
      payout_released_at: new Date().toISOString(),
    })
    .eq('id', sponsorshipId);

  if (error) throw error;
  return true;
}

// --- helpers ---------------------------------------------------------------

async function loadCreatorAccountId(creatorProfileId: string): Promise<string | null> {
  const { data, error } = await getAdminClient()
    .from('creator_profiles')
    .select('stripe_account_id')
    .eq('id', creatorProfileId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.stripe_account_id as string | null) ?? null;
}
