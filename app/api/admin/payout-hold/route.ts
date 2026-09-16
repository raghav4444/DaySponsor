/**
 * POST /api/admin/payout-hold
 *
 * Holds or releases a creator payout. No Stripe call is made: the sponsorship is flagged
 * so the payout job skips it, and clearing the flag makes it eligible again.
 *
 * Body: `{ sponsorshipId, hold: boolean, reason?: string }`.
 * The reason is capped server-side; it is never used to steer money.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { adminHoldPayout, adminReleaseHold } from '@/lib/admin-actions';

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

    const reason =
      typeof body.reason === 'string' && body.reason.length > 0
        ? body.reason
        : 'Held by an administrator';

    const result =
      body.hold === false ? await adminReleaseHold(sponsorshipId) : await adminHoldPayout(sponsorshipId, reason);

    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (thrown) {
    return handleRouteError('admin.payoutHold', thrown);
  }
}
