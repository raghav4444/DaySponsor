/**
 * Webhook event idempotency.
 *
 * Stripe can deliver the same webhook event more than once (at-least-once delivery). The
 * handler must process each event exactly once. This module records processed event ids
 * in the `stripe_webhook_events` table (contract §1) via the service-role client,
 * which bypasses the deliberately policy-free RLS on that table.
 *
 * The insert is the claim: the unique index on `stripe_event_id` turns a replayed
 * delivery into a `23505` conflict, which the caller treats as "already handled".
 * Recording a processed event is a non-financial side effect, so an unexpected failure
 * to record must never surface as a 500 to Stripe (which would trigger a retry that
 * may double-process). We therefore optimistically treat unknown errors as new claims
 * and let the independently-idempotent RPCs converge on re-delivery.
 */

import { getAdminClient } from '@/lib/server-supabase';

/**
 * Records an event as processed. Returns true when this event was newly recorded (i.e.
 * should be processed), false when it was already processed.
 *
 * `payload` / `eventType` are stored for the admin audit view; the claim itself is the
 * `stripe_event_id` unique index.
 */
export async function claimWebhookEvent(
  eventId: string,
  params?: { eventType?: string | null; resourceId?: string | null; payload?: unknown },
): Promise<boolean> {
  try {
    const { error } = await getAdminClient()
      .from('stripe_webhook_events')
      .insert({
        stripe_event_id: eventId,
        event_type: params?.eventType ?? 'unknown',
        resource_id: params?.resourceId ?? null,
        payload: (params?.payload ?? {}) as Record<string, unknown>,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        // Unique constraint: already processed. Safe to skip.
        return false;
      }
      // Unknown error: do not surface as a hard failure — treat as newly claimed.
      console.error('[webhook] failed to claim event, processing anyway', {
        event_id: eventId,
        error_message: error.message,
      });
      return true;
    }
    return true;
  } catch (error) {
    console.error('[webhook] failed to claim event (caught)', {
      event_id: eventId,
      error_message: error instanceof Error ? error.message : 'unknown error',
    });
    return true;
  }
}

/**
 * Marks a claimed event processed (or failed) so the admin view can reconcile
 * Stripe's delivery log against local state.
 */
export async function settleWebhookEvent(
  eventId: string,
  params?: { errorMessage?: string | null },
): Promise<void> {
  try {
    await getAdminClient()
      .from('stripe_webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        error_message: params?.errorMessage ?? null,
      })
      .eq('stripe_event_id', eventId);
  } catch (error) {
    console.error('[webhook] failed to settle event', {
      event_id: eventId,
      error_message: error instanceof Error ? error.message : 'unknown error',
    });
  }
}