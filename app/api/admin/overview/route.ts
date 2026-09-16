/**
 * GET /api/admin/overview
 *
 * Platform-wide counts and revenue totals for the admin dashboard. Read-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError } from '@/lib/stripe/api-helpers';
import { loadPlatformTotals, loadRevenueTotals } from '@/lib/admin-queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const [counts, revenue] = await Promise.all([
      loadPlatformTotals(),
      loadRevenueTotals(),
    ]);

    return NextResponse.json({ counts, revenue });
  } catch (thrown) {
    return handleRouteError('admin.overview', thrown);
  }
}
