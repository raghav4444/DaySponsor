/**
 * GET /api/admin/transfers   and   GET /api/admin/refunds
 *
 * Read-only reconciliation lists: what was transferred to creators, and what was
 * refunded to brands, with the Stripe object ids so an admin can cross-check against
 * the Stripe dashboard.
 */

import { NextResponse } from 'next/server';
import { requireAdmin, handleRouteError } from '@/lib/stripe/api-helpers';
import { loadAdminTransfers, loadAdminRefunds, loadAdminWebhookEvents } from '@/lib/admin-queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const [transfers, refunds, webhookEvents] = await Promise.all([
      loadAdminTransfers(),
      loadAdminRefunds(),
      loadAdminWebhookEvents(),
    ]);

    return NextResponse.json({ transfers, refunds, webhookEvents });
  } catch (thrown) {
    return handleRouteError('admin.listTransfers', thrown);
  }
}
