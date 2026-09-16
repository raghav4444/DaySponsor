/**
 * POST /api/admin/dispute
 *
 * Reports the dispute status for a sponsorship's charge, read live from Stripe.
 * Read-only: a dispute is responded to in the Stripe Dashboard, not from here.
 *
 * Body: `{ sponsorshipId }`.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { adminDisputeStatus } from '@/lib/admin-actions';

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

    const result = await adminDisputeStatus(sponsorshipId);

    return NextResponse.json(result);
  } catch (thrown) {
    return handleRouteError('admin.disputeStatus', thrown);
  }
}
