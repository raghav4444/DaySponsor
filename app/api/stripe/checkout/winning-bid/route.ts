import { NextResponse } from 'next/server';
import {
  requireBrand,
  handleRouteError,
  isPost,
  errorResponse,
} from '@/lib/stripe/api-helpers';
import {
  resolveCheckout,
  createCheckoutSession,
  persistCheckoutSession,
  CheckoutValidationError,
} from '@/lib/stripe/checkout';
import { notify } from '@/lib/notifications';

/**
 * POST /api/stripe/checkout/winning-bid
 *
 * Creates a Stripe Checkout Session for a winning bid.
 *
 * The client may send ONLY:
 *   { sponsorshipId }  or  { bidId }
 *
 * Amount, currency, fee split, and destination are all resolved server-side from the
 * database. This route never marks the sponsorship paid — payment is confirmed only by
 * the webhook handler when Stripe says the charge succeeded.
 */
export async function POST(request: Request) {
  if (!isPost(request)) return errorResponse('Method not allowed.', 405, 'method_not_allowed');

  const { profile, error } = await requireBrand(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid request body.', 400, 'invalid_body');
  }

  // Only these two references are accepted. Any other field is ignored, never echoed.
  const sponsorshipId = takeOptionalString(body, 'sponsorshipId');
  const bidId = takeOptionalString(body, 'bidId');

  try {
    const resolved = await resolveCheckout({
      sponsorshipId,
      bidId,
      brandProfileId: profile.id,
    });

    const session = await createCheckoutSession(resolved, {
      // A per-request token keeps a double-click from creating two sessions.
      idempotencyToken: takeOptionalString(body, 'flowToken') ?? 'default',
    });

    const persisted = await persistCheckoutSession(resolved, session);

    // Tell the winner payment is required. Fire-and-forget: never blocks checkout.
    void notify({
      recipientId: resolved.brandProfileId,
      type: 'payment_required',
      relatedType: 'sponsorship',
      relatedId: resolved.sponsorshipId,
      href: persisted.url ?? `/dashboard/brand`,
    });

    // Only the hosted URL and the session id leave the server. No client secrets, no
    // account ids, no amounts the client could tamper with.
    return NextResponse.json({
      url: persisted.url,
      sessionId: persisted.sessionId,
      sponsorshipId: resolved.sponsorshipId,
    });
  } catch (thrown) {
    if (thrown instanceof CheckoutValidationError) {
      return errorResponse(thrown.message, thrown.statusCode, thrown.code);
    }
    return handleRouteError('checkout.createSession', thrown);
  }
}

/** Reads an optional string field, rejecting anything that is not a string. */
function takeOptionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}