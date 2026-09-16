/**
 * Admin financial actions.
 *
 * Each of these mutates money or the path money will take. They are only ever called from
 * a protected server route (`app/api/admin/**`), never from a browser Supabase client —
 * a browser has no service-role key and no route to these functions.
 *
 * Every action is idempotent at the Stripe layer (stable idempotency keys per operation)
 * and re-verifies state before touching Stripe, so an accidental double-click or a
 * retried request cannot refund twice or pay twice.
 */

import { assessRefund, refundBeforePayout, refundAfterPayout } from '@/lib/stripe/refunds';
import { releasePayout, validatePayout } from '@/lib/stripe/payouts';
import { loadSponsorshipForPayout } from '@/lib/auction-queries';
import { getAdminClient } from '@/lib/server-supabase';
import { loadDisputeStatus } from '@/lib/admin-queries';
import { notify } from '@/lib/notifications';

export type AdminActionResult = {
  ok: boolean;
  /** What actually happened, for the admin UI. */
  message: string;
  /** Machine-readable outcome for the caller. */
  code: string;
};

/**
 * Refunds a sponsorship.
 *
 * Chooses the path from the current payout state, not from the admin's choice: a
 * pre-payout refund cancels the charge and blocks the transfer; a post-payout refund
 * reverses the transfer. The amount refunded is always the recorded charge amount.
 *
 * Never claims recovery before Stripe confirms: this returns `ok: true` only after the
 * refund or reversal is recorded against a Stripe object id.
 */
export async function adminRefund(sponsorshipId: string): Promise<AdminActionResult> {
  const assessment = await assessRefund(sponsorshipId);

  if (assessment.path === 'already_refunded') {
    return {
      ok: true,
      code: 'already_refunded',
      message: 'This sponsorship is already refunded.',
    };
  }

  if (assessment.path === 'not_paid') {
    return {
      ok: false,
      code: 'not_paid',
      message: 'This sponsorship was never charged, so there is nothing to refund.',
    };
  }

  try {
    if (assessment.path === 'pre_payout') {
      const result = await refundBeforePayout(sponsorshipId);
      void notifyBrandOfRefund(sponsorshipId, result.refundId);
      return {
        ok: true,
        code: 'refunded_pre_payout',
        message: 'Refunded and the creator payout was blocked.',
      };
    }

    const result = await refundAfterPayout(sponsorshipId);
    void notifyBrandOfRefund(sponsorshipId, result.refundId);
    return {
      ok: true,
      code: 'refunded_post_payout',
      message: 'Refunded and the creator transfer was reversed.',
    };
  } catch (thrown) {
    return {
      ok: false,
      code: 'refund_failed',
      message: errorMessage(thrown) ?? 'The refund failed. No money was moved.',
    };
  }
}

/**
 * Tells the brand their sponsorship was refunded.
 *
 * Fire-and-forget on purpose: a failed notification must never roll back a refund that
 * Stripe has already confirmed. A missing recipient is skipped rather than fatal.
 */
async function notifyBrandOfRefund(sponsorshipId: string, refundId: string | null) {
  const { data } = await getAdminClient()
    .from('sponsorships')
    .select('brand_id')
    .eq('id', sponsorshipId)
    .maybeSingle();

  const brandId = data?.brand_id;
  if (!brandId) return;

  void notify({
    recipientId: brandId,
    type: 'refund_completed',
    relatedType: 'sponsorship',
    relatedId: sponsorshipId,
    body: refundId ? `Your sponsorship has been refunded (${refundId}).` : 'Your sponsorship has been refunded.',
  });
}

/**
 * Puts a payout on hold. The sponsorship is marked so the payout job skips it; no Stripe
 * call is made and no money moves. Reversible by clearing the hold.
 */
export async function adminHoldPayout(
  sponsorshipId: string,
  reason: string,
): Promise<AdminActionResult> {
  const sponsorship = await loadSponsorshipForPayout(sponsorshipId);
  if (!sponsorship) {
    return { ok: false, code: 'not_found', message: 'Sponsorship not found.' };
  }

  if (sponsorship.payout_status === 'released') {
    return {
      ok: false,
      code: 'already_released',
      message: 'This payout has already been released; it cannot be held.',
    };
  }

  const { error } = await getAdminClient()
    .from('sponsorships')
    .update({
      payout_hold: true,
      payout_hold_reason: reason.slice(0, 500) || 'Held by an administrator',
    })
    .eq('id', sponsorshipId);

  if (error) {
    return {
      ok: false,
      code: 'write_failed',
      message: 'The hold could not be recorded.',
    };
  }

  return {
    ok: true,
    code: 'held',
    message: 'Payout held. The payout job will skip this sponsorship.',
  };
}

/**
 * Clears a payout hold.
 */
export async function adminReleaseHold(sponsorshipId: string): Promise<AdminActionResult> {
  const { error } = await getAdminClient()
    .from('sponsorships')
    .update({ payout_hold: false, payout_hold_reason: null })
    .eq('id', sponsorshipId);

  if (error) {
    return { ok: false, code: 'write_failed', message: 'The hold could not be cleared.' };
  }

  return {
    ok: true,
    code: 'hold_cleared',
    message: 'Hold cleared. The sponsorship is eligible for the next payout run.',
  };
}

/**
 * Retries a payout for one sponsorship.
 *
 * Re-runs every precondition before transferring, so holding this button on a refunded
 * or incomplete sponsorship does nothing rather than something wrong.
 */
export async function adminRetryPayout(sponsorshipId: string): Promise<AdminActionResult> {
  try {
    const result = await releasePayout(sponsorshipId);
    if (result.transferred) {
      return {
        ok: true,
        code: 'transferred',
        message: 'The creator payout was released.',
      };
    }
    const blocking = result.validation.blocking ?? 'unknown';
    return {
      ok: false,
      code: `blocked:${blocking}`,
      message: `Payout blocked: ${preconditionMessage(blocking)}`,
    };
  } catch (thrown) {
    return {
      ok: false,
      code: 'payout_failed',
      message: errorMessage(thrown) ?? 'The payout failed. No money was moved.',
    };
  }
}

/**
 * Safe reconciliation for one sponsorship: verifies the recorded payment state against
 * what Stripe reports, without moving anything.
 */
export async function adminReconcileOne(
  sponsorshipId: string,
): Promise<AdminActionResult & { drift: string[] }> {
  const sponsorship = await loadSponsorshipForPayout(sponsorshipId);
  if (!sponsorship) {
    return { ok: false, code: 'not_found', message: 'Sponsorship not found.', drift: [] };
  }

  const drift: string[] = [];

  const status = sponsorship.status as string | null;
  const paymentIntentId = sponsorship.stripe_payment_intent_id as string | null;

  // A sponsorship marked paid must have a payment intent.
  if (status === 'paid' && !paymentIntentId) {
    drift.push('Marked paid without a recorded payment intent.');
  }

  // And the charge must actually have succeeded.
  if (status === 'paid' && paymentIntentId) {
    const { verifyChargeSucceeded } = await import('@/lib/stripe/payouts');
    const ok = await verifyChargeSucceeded(paymentIntentId);
    if (!ok) drift.push('Marked paid but the charge is not succeeded at Stripe.');
  }

  // A transferred sponsorship must have a transfer id.
  if (sponsorship.payout_status === 'released' && !sponsorship.stripe_transfer_id) {
    drift.push('Marked released without a recorded transfer.');
  }

  // And any dispute must be reflected in the local status.
  if (paymentIntentId) {
    const dispute = await loadDisputeStatus(paymentIntentId);
    if (dispute.has_dispute && status !== 'refunded' && status !== 'cancelled') {
      drift.push(`Open dispute at Stripe (${dispute.status}) is not reflected locally.`);
    }
  }

  return {
    ok: drift.length === 0,
    code: drift.length === 0 ? 'consistent' : 'drift_detected',
    message:
      drift.length === 0
        ? 'No drift detected.'
        : `${drift.length} inconsistency${drift.length === 1 ? '' : 'ies'} detected.`,
    drift,
  };
}

/**
 * Reports dispute status without mutating anything. Read live from Stripe.
 */
export async function adminDisputeStatus(sponsorshipId: string): Promise<
  AdminActionResult & {
    hasDispute: boolean;
    status: string | null;
  }
> {
  const sponsorship = await loadSponsorshipForPayout(sponsorshipId);
  if (!sponsorship) {
    return { ok: false, code: 'not_found', message: 'Sponsorship not found.', hasDispute: false, status: null };
  }

  const paymentIntentId = sponsorship.stripe_payment_intent_id as string | null;
  const dispute = await loadDisputeStatus(paymentIntentId ?? '');

  return {
    ok: true,
    code: dispute.has_dispute ? 'dispute_open' : 'no_dispute',
    message: dispute.has_dispute
      ? `Dispute open at Stripe: ${dispute.status}.`
      : 'No dispute recorded for this payment.',
    hasDispute: dispute.has_dispute,
    status: dispute.status,
  };
}

function errorMessage(thrown: unknown): string | null {
  const message = (thrown as { message?: string })?.message;
  return typeof message === 'string' && message.length > 0 ? message : null;
}

function preconditionMessage(precondition: string): string {
  const known: Record<string, string> = {
    sponsorship_exists: 'the sponsorship could not be loaded',
    sponsorship_paid: 'the sponsorship is not marked paid',
    not_refunded: 'the sponsorship has been refunded',
    not_on_hold: 'an administrator has placed the payout on hold',
    creator_connected_and_eligible: 'the creator has not completed Stripe onboarding',
    charge_succeeded: 'the charge has not succeeded',
    creator_amount_positive: 'the recorded creator amount is invalid',
  };
  return known[precondition] ?? precondition;
}
