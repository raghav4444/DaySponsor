/**
 * POST /api/admin/refund
 *
 * Refunds a sponsorship. This is a financial mutation, so it lives in a protected server
 * route and is never reachable from a browser Supabase client.
 *
 * Body: `{ sponsorshipId }`. The refund path (pre- or post-payout) and the amount are
 * resolved server-side from the recorded state; the admin does not choose either.
 *
 * Idempotent: an already-refunded sponsorship returns `already_refunded` and moves nothing.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { adminRefund } from '@/lib/admin-actions';

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

    const result = await adminRefund(sponsorshipId);

    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (thrown) {
    return handleRouteError('admin.refund', thrown);
  }
}
