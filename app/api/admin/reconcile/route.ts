/**
 * POST /api/admin/reconcile
 *
 * Safe reconciliation: compares the recorded payment state against Stripe and reports
 * drift. Reads only — no refund, no transfer, no status write.
 *
 * Body: `{ sponsorshipId }` for one row, or `{}` for the drift list.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { adminReconcileOne } from '@/lib/admin-actions';
import { loadReconciliationDrift as listDrift } from '@/lib/admin-queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isPost(request)) return errorResponse('Method not allowed.', 405, 'method_not_allowed');

  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // An empty body is allowed — it means "list the drift".
    }

    const sponsorshipId =
      typeof body.sponsorshipId === 'string' && body.sponsorshipId.length > 0
        ? body.sponsorshipId
        : null;

    if (sponsorshipId) {
      const result = await adminReconcileOne(sponsorshipId);
      return NextResponse.json(result);
    }

    const drift = await listDrift();
    return NextResponse.json({
      ok: drift.length === 0,
      code: drift.length === 0 ? 'consistent' : 'drift_detected',
      message:
        drift.length === 0
          ? 'No drift detected.'
          : `${drift.length} paid sponsorship${drift.length === 1 ? '' : 's'} recorded no transfer.`,
      drift,
    });
  } catch (thrown) {
    return handleRouteError('admin.reconcile', thrown);
  }
}
