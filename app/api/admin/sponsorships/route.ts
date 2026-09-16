/**
 * GET /api/admin/sponsorships
 *
 * Read-only oversight of every sponsorship with its payment, payout and refund state.
 *
 * Admin authorization is enforced by `requireAdmin`, which resolves the bearer token to
 * a profile whose role is `admin`. The service-role client is used because RLS would
 * otherwise return only the caller's own rows — the point of this route is the union.
 *
 * This route performs no mutation of any kind.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError } from '@/lib/stripe/api-helpers';
import { loadAdminSponsorships } from '@/lib/admin-queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const rows = await loadAdminSponsorships();

    return NextResponse.json({ sponsorships: rows });
  } catch (thrown) {
    return handleRouteError('admin.listSponsorships', thrown);
  }
}
