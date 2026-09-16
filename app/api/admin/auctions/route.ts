/**
 * GET /api/admin/auctions
 *
 * All slots with their auction state: highest bid, bid count, end time, status, and the
 * number of fallback winners attempted. Read-only.
 *
 * The highest bidder's name is included because an admin legitimately needs to see who
 * is in the lead when resolving a failed auction. Losing bidders are never returned.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError } from '@/lib/stripe/api-helpers';
import { loadAdminAuctions } from '@/lib/admin-queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const rows = await loadAdminAuctions();

    return NextResponse.json({ auctions: rows });
  } catch (thrown) {
    return handleRouteError('admin.listAuctions', thrown);
  }
}
