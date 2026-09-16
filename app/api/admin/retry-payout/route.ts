/**
 * POST /api/admin/retry-payout
 *
 * Retries a single creator payout. Every precondition is re-verified before the transfer,
 * so this button on a refunded, held or incomplete sponsorship is a no-op rather than a
 * wrong payment.
 *
 * Body: `{ sponsorshipId }`. The amount transferred is always the recorded
 * `creator_amount`; the admin supplies no amount.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { adminRetryPayout } from '@/lib/admin-actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isPost(request)) return errorResponse('Method not allowed.', 405, 'method_not_allowed');

  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return errorResponse('Invalid request body.', 400, 'invalid_body');
    }

    const sponsorshipId =
      typeof body.sponsorshipId === 'string' && body.sponsorshipId.length > 0
        ? body.sponsorshipId
        : null;

    if (!sponsorshipId) {
      return errorResponse('A sponsorship id is required.', 400, 'missing_sponsorship');
    }

    const result = await adminRetryPayout(sponsorshipId);

    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (thrown) {
    return handleRouteError('admin.retryPayout', thrown);
  }
}
