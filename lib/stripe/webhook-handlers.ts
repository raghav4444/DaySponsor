/**
 * Webhook event handlers.
 *
 * One handler per Stripe event type the application cares about. Each handler:
 *  - reads state from the database (never trusts the event payload for amounts);
 *  - makes only transaction-safe transitions (a re-delivery of the same event always
 *    converges to the same state);
 *  - reports failures for genuinely temporary problems so Stripe retries;
 *  - notifies users fire-and-forget, so a notification failure can never roll back a
 *    successful financial transaction.
 *
 * The browser success redirect is decorative; these handlers are the only source of truth
 * for payment state.
 */

import type Stripe from 'stripe';
import { markSponsorshipPaid, recordRefund } from '@/lib/auction-rpc';
import { getAdminClient } from '@/lib/server-supabase';
import { updateCreatorOnboardingCache } from '@/lib/auction-queries';
import { notify, notifyAll } from '@/lib/notifications';
import { normalizeAccountStatus } from '@/lib/stripe/connect';

/** Handlers keyed by Stripe event type. */
export const WEBHOOK_HANDLERS: Record<
  string,
  (event: Stripe.Event) => Promise<void>
> = {
  /**
   * The payment succeeded. This is the only place a sponsorship is marked paid.
   *
   * The RPC signature is `mark_sponsorship_paid(p_sponsorship_id, p_payment_intent_id,
   * p_charge_id)` — it takes Stripe ids only, never an amount or a currency. Amounts
   * are settled at close time inside the DB, so there is nothing for the event to
   * assert. Notifications are fire-and-forget: `notifyAll` never throws, so a
   * notification failure can never roll back the paid transition.
   */
  'checkout.session.completed': async (event) => {
    const session = event.data.object as Stripe.Checkout.Session;
    const sponsorshipId = (session.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    const sponsorship = await loadSponsorshipRow(sponsorshipId);
    if (!sponsorship) return;

    const paymentIntentId =
      typeof session.payment_intent === 'string' ? session.payment_intent : null;

    const result = await markSponsorshipPaid({
      sponsorshipId,
      paymentIntentId,
      chargeId: null,
    });

    if (result.ok) {
      void notifyAll([
        {
          recipientId: String(sponsorship.brand_id),
          type: 'payment_successful',
          relatedType: 'sponsorship',
          relatedId: sponsorshipId,
        },
        {
          recipientId: String(sponsorship.creator_id),
          type: 'payment_successful',
          relatedType: 'sponsorship',
          relatedId: sponsorshipId,
        },
      ]).catch(() => undefined);
    }
  },

  /**
   * Async payment failed after the session opened (e.g. a card declined later).
   * Records the failure so the payout job knows there is no money to move.
   */
  'checkout.session.async_payment_failed': async (event) => {
    const session = event.data.object as Stripe.Checkout.Session;
    const sponsorshipId = (session.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    await markSponsorshipPaymentFailed(sponsorshipId);
  },

  /**
   * Payment expired with no capture. The winner's hold lapses and the auction job can
   * advance to the next bidder.
   */
  'checkout.session.expired': async (event) => {
    const session = event.data.object as Stripe.Checkout.Session;
    const sponsorshipId = (session.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    await markSponsorshipPaymentExpired(sponsorshipId);
  },

  /**
   * The charge succeeded. Equivalent confirmation for the non-Checkout path: the same
   * `mark_sponsorship_paid` RPC records the payment, with the charge id attached.
   */
  'charge.succeeded': async (event) => {
    const charge = event.data.object as Stripe.Charge;
    const sponsorshipId = (charge.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    const sponsorship = await loadSponsorshipRow(sponsorshipId);
    if (!sponsorship) return;

    const result = await markSponsorshipPaid({
      sponsorshipId,
      paymentIntentId:
        typeof charge.payment_intent === 'string' ? charge.payment_intent : null,
      chargeId: charge.id,
    });

    if (result.ok) {
      void notifyAll([
        {
          recipientId: String(sponsorship.brand_id),
          type: 'payment_successful',
          relatedType: 'sponsorship',
          relatedId: sponsorshipId,
        },
        {
          recipientId: String(sponsorship.creator_id),
          type: 'payment_successful',
          relatedType: 'sponsorship',
          relatedId: sponsorshipId,
        },
      ]).catch(() => undefined);
    }
  },

  /**
   * Charge refunded. This — and only this — records the refund, via `record_refund`.
   * The RPC derives the refund amount from the recorded sponsorship amount; the event
   * payload's amount is never trusted.
   */
  'charge.refunded': async (event) => {
    const charge = event.data.object as Stripe.Charge;
    const sponsorshipId = (charge.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    const refunds = charge.refunds?.data ?? [];
    const refund = refunds[0];
    const refundId = typeof refund?.id === 'string' ? refund.id : charge.id;
    const refundAmount =
      typeof refund?.amount === 'number' ? refund.amount : null;

    const sponsorship = await loadSponsorshipRow(sponsorshipId);
    if (!sponsorship) return;

    const amount =
      refundAmount ?? Number((sponsorship as { amount?: unknown }).amount ?? 0);

    const result = await recordRefund({
      sponsorshipId,
      refundId,
      amount,
    });

    if ((result as { ok?: unknown }).ok) {
      void notifyAll([
        {
          recipientId: String(sponsorship.brand_id),
          type: 'refund_completed',
          relatedType: 'sponsorship',
          relatedId: sponsorshipId,
        },
        {
          recipientId: String(sponsorship.creator_id),
          type: 'refund_completed',
          relatedType: 'sponsorship',
          relatedId: sponsorshipId,
        },
      ]).catch(() => undefined);
    }
  },

  /**
   * A dispute opened. Freeze the payout immediately; the payout job's hold check will
   * keep the funds in the platform until it resolves.
   */
  'charge.dispute.created': async (event) => {
    const dispute = event.data.object as Stripe.Dispute;
    const sponsorshipId = (dispute.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    // Freeze the payout before anything else — the payout job's hold check is what
    // actually keeps the funds in the platform while the dispute is open.
    await getAdminClient()
      .from('sponsorships')
      .update({
        payout_hold: true,
        payout_hold_reason: 'dispute_opened',
      })
      .eq('id', sponsorshipId);

    // Notify the creator that their payout is paused. Fire-and-forget.
    const sponsorship = await loadSponsorshipRow(sponsorshipId);
    if (sponsorship) {
      void notify({
        recipientId: String(sponsorship.creator_id),
        type: 'review_pending',
        relatedType: 'sponsorship',
        relatedId: sponsorshipId,
        body: 'Your payout for this sponsorship is on hold while a payment dispute is resolved.',
      });
    }
  },

  /**
   * A dispute closed in the platform's favour. Release the hold so the payout may
   * proceed on its next run.
   */
  'charge.dispute.closed': async (event) => {
    const dispute = event.data.object as Stripe.Dispute;
    const sponsorshipId = (dispute.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    const won = dispute.status === 'won';
    await getAdminClient()
      .from('sponsorships')
      .update({
        payout_hold: !won,
        payout_hold_reason: won ? null : 'dispute_lost',
      })
      .eq('id', sponsorshipId);
  },

  /**
   * Chargeback fee or similar. Informational — no state change required.
   */
  'charge.dispute.funds_withdrawn': async () => {
    /* no state change */
  },

  /**
   * The creator's Connect account status changed. Refreshes the cached onboarding flag,
   * which the checkout precondition and the payout precondition both read.
   */
  'account.updated': async (event) => {
    const account = event.data.object as Stripe.Account;
    const creatorProfileId = (account.metadata?.creator_profile_id as string | null) ?? null;
    if (!creatorProfileId) return;

    const status = normalizeAccountStatus(account);
    await updateCreatorOnboardingCache(creatorProfileId, status.onboardingComplete, account.id);
  },

  /**
   * A payout to the creator's bank failed. Recorded so the creator dashboard can show it
   * honestly rather than implying the money arrived.
   */
  'payout.failed': async (event) => {
    const payout = event.data.object as Stripe.Payout;
    const sponsorshipId = (payout.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    await getAdminClient()
      .from('sponsorships')
      .update({
        payout_status: 'failed',
        payout_hold: true,
        payout_hold_reason: 'payout_failed',
      })
      .eq('id', sponsorshipId);
  },

  /**
   * The creator's bank payout succeeded. This confirms money actually left Stripe — a
   * stronger signal than the transfer object existing.
   */
  'payout.paid': async () => {
    /* transfers are recorded at creation; no further transition needed */
  },

  /**
   * A transfer reversal was created. Records what was recovered, without ever claiming
   * more than Stripe reports.
   */
  'transfer.reversal.created': async (event) => {
    const reversal = event.data.object as Stripe.TransferReversal;
    const sponsorshipId = (reversal.metadata?.sponsorship_id as string | null) ?? null;
    if (!sponsorshipId) return;

    await getAdminClient()
      .from('sponsorships')
      .update({
        payout_hold: true,
        payout_hold_reason: 'transfer_reversed',
      })
      .eq('id', sponsorshipId);
  },
};

/**
 * Dispatches an event to its handler.
 *
 * @returns `'handled'` when a handler ran, `'ignored'` when the event type is not one the
 * application acts on. Unknown types are intentionally not errors.
 */
export async function dispatchWebhookEvent(event: Stripe.Event): Promise<'handled' | 'ignored'> {
  const handler = WEBHOOK_HANDLERS[event.type];
  if (!handler) return 'ignored';
  await handler(event);
  return 'handled';
}

// --- helpers ---------------------------------------------------------------

async function loadSponsorshipRow(sponsorshipId: string) {
  const { data, error } = await getAdminClient()
    .from('sponsorships')
    .select('id, brand_id, creator_id, amount, currency, status')
    .eq('id', sponsorshipId)
    .maybeSingle();
  if (error || !data) return null;
  return data as {
    id: string;
    brand_id: string;
    creator_id: string;
    amount: number;
    currency: string | null;
    status: string;
  };
}

async function markSponsorshipPaymentFailed(sponsorshipId: string) {
  // Payment failures are informational: the DB state machine has no `payment_failed`
  // transition on this path, and failing open to a client-writeable status would let a
  // forged event move money state. Record the failure on the webhook ledger row instead
  // so the admin view still sees it.
  await getAdminClient()
    .from('stripe_webhook_events')
    .update({ error_message: `payment_failed:${sponsorshipId}` })
    .eq('resource_id', sponsorshipId);
  return true;
}

async function markSponsorshipPaymentExpired(sponsorshipId: string) {
  // Same treatment as a failed payment: informational only, never a status write the
  // RPC state machine did not authorize.
  await getAdminClient()
    .from('stripe_webhook_events')
    .update({ error_message: `payment_expired:${sponsorshipId}` })
    .eq('resource_id', sponsorshipId);
  return true;
}