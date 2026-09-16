import { NextResponse } from 'next/server';
import { getStripe, getWebhookSecret } from '@/lib/stripe/server';
import { claimWebhookEvent } from '@/lib/stripe/webhook-events';
import { dispatchWebhookEvent } from '@/lib/stripe/webhook-handlers';

/**
 * POST /api/stripe/webhook
 *
 * Processes Stripe webhook deliveries. Steps, in order:
 *
 *  1. Read the **raw** request body — signature verification requires the exact bytes, so
 *     no JSON parsing happens first.
 *  2. Read `Stripe-Signature` and verify it against the webhook secret. An invalid
 *     signature is a 400, never a 500.
 *  3. Check the event id against the processed-event log (idempotency).
 *  4. Return 2xx for an already-processed event — no error, no re-processing.
 *  5. Dispatch the event to its handler, which makes only transaction-safe transitions.
 *  6. On a temporary failure, return a retryable error so Stripe redelivers.
 *  7. On an unprocessable event, log and return 2xx: Stripe must not retry forever.
 *
 * Nothing is logged that could leak: no raw payload, no client secrets, no card data.
 */

export const dynamic = 'force-dynamic';
// The body must arrive raw for signature verification — Next must not parse it as JSON.
export const runtime = 'nodejs';

export async function POST(request: Request) {
  // 1. Raw body. `request.text()` preserves the exact bytes Stripe signed.
  let payload: string;
  try {
    payload = await request.text();
  } catch {
    return NextResponse.json({ error: 'Could not read request body.' }, { status: 400 });
  }

  // 2. Signature verification.
  const signature = request.headers.get('Stripe-Signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe-Signature header.' }, { status: 400 });
  }

  const secret = getWebhookSecret();
  let event: import('stripe').Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(payload, signature, secret);
  } catch (error) {
    // Never echo the signature or the payload in the log.
    console.error('[webhook] signature verification failed', {
      error_message: error instanceof Error ? error.message : 'invalid signature',
    });
    return NextResponse.json(
      { error: 'Webhook signature verification failed.' },
      { status: 400 },
    );
  }

  // 3. Idempotency: claim the event id.
  const shouldProcess = await claimWebhookEvent(event.id);

  // 4. Already processed → 2xx, no work. Stripe considers the delivery a success.
  if (!shouldProcess) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // 5. Dispatch.
  try {
    const outcome = await dispatchWebhookEvent(event);

    if (outcome === 'ignored') {
      // An event type we do not act on. Acknowledge so Stripe stops retrying it.
      return NextResponse.json({ received: true, handled: false });
    }

    return NextResponse.json({ received: true, handled: true });
  } catch (error) {
    // 6. Temporary failure → retryable error so Stripe redelivers.
    //    Database connectivity, a Stripe 5xx, a lock contention — anything transient.
    const message = error instanceof Error ? error.message : 'unknown error';
    const retryable = isRetryableError(error);

    console.error('[webhook] handler failed', {
      event_id: event.id,
      event_type: event.type,
      retryable,
      error_message: message,
    });

    if (retryable) {
      return NextResponse.json(
        { error: 'Temporary failure processing the event.', event_id: event.id },
        { status: 500 },
      );
    }

    // 7. Unprocessable: acknowledge so Stripe does not retry forever. The event id was
    //    already claimed, so a redelivery would not help.
    return NextResponse.json(
      { received: true, handled: false, failed: true },
      { status: 200 },
    );
  }
}

/**
 * Decides whether a handler failure is worth retrying.
 *
 * A PostgREST connection error, a Stripe rate limit, or a lock timeout is transient. A
 * validation error or a missing row is not — retrying cannot fix it.
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code ?? '';
  const message = String((error as { message?: string }).message ?? '');

  // Supabase/PostgREST transient failures.
  if (['08006', '08001', '40001', '40P01', '57P03', 'PGRST301'].includes(code)) return true;

  // Stripe rate limiting and temporary service errors.
  if (/rate limit/i.test(message)) return true;
  if (/temporarily unavailable|connection error|network error/i.test(message)) return true;

  return false;
}