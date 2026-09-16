/**
 * Webhook event idempotency.
 *
 * Stripe can deliver the same webhook event more than once (at-least-once delivery). The
 * handler must process each event exactly once. This module records processed event ids:
 *
 *  - In production, in the `webhook_events` table (Engineer A's schema, contract §3.5),
 *    via a service-role client.
 *  - Until that migration merges, degraded to an in-process Set scoped to the server
 *    instance. The Set is not durable across cold starts, so a rare duplicate may slip
 *    through in dev — every handler beneath it is nevertheless idempotent by design.
 *
 * Recording a processed event is a non-financial side effect, so a failure to record must
 * never surface as a 500 to Stripe (which would trigger a retry that may double-process).
 * We therefore *always* record optimistically and treat duplicate detection as best-effort
 * in the fallback mode.
 */

import { getAdminClient } from '@/lib/server-supabase';

// PostgREST error code for a missing table/function.
const TABLE_MISSING = 'PGRST205';

/** In-process duplicate cache (fallback until the table exists). */
const processedInMemory = new Set<string>();

function isTableMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (code === TABLE_MISSING) return true;
  const message = String((error as { message?: string }).message ?? '');
  return /relation .* does not exist|table .* does not exist/i.test(message);
}

/**
 * Records an event as processed. Returns true when this event was newly recorded (i.e.
 * should be processed), false when it was already processed.
 */
export async function claimWebhookEvent(eventId: string): Promise<boolean> {
  if (processedInMemory.has(eventId)) return false;

  try {
    const { error } = await getAdminClient().from('webhook_events').insert({
      event_id: eventId,
      processed_at: new Date().toISOString(),
    });
    if (error) {
      if (isTableMissing(error)) {
        // Table not migrated yet: fall back to the in-memory cache.
        return claimInMemory(eventId);
      }
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
    processedInMemory.add(eventId);
    console.error('[webhook] failed to claim event (caught)', {
      event_id: eventId,
      error_message: error instanceof Error ? error.message : 'unknown error',
    });
    return true;
  }
}

/** In-memory claim with a duplicate guard. */
function claimInMemory(eventId: string): boolean {
  if (processedInMemory.has(eventId)) return false;
  processedInMemory.add(eventId);
  return true;
}