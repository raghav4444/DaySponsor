/**
 * POST /api/cron/reconcile-payments
 *
 * Scheduled job: reads payment state and reports drift. It does not move money, refund,
 * or write to any financial row — it surfaces what an admin should look at.
 *
 * Authorization is `Authorization: Bearer <CRON_SECRET>`. No ids or amounts are read
 * from the request; the report is computed from the database.
 *
 * Recommended cadence: hourly. Read-only and idempotent by construction.
 */

import { runCronJob, cronCurrency } from '@/lib/cron-guard';
import {
  loadUnreconciledSponsorships,
  loadEndedWithoutWinnerSlots,
  loadPaidWithoutPaymentIntent,
} from '@/lib/cron-queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, 'reconcile-payments', async () => {
    const [unreconciled, endedSlots, paidWithoutIntent] = await Promise.all([
      loadUnreconciledSponsorships(),
      loadEndedWithoutWinnerSlots(),
      loadPaidWithoutPaymentIntent(),
    ]);

    // Drift counts only. No sponsorship ids go into the response body — those belong in
    // the admin dashboard, behind its own authorization, not in a scheduler log.
    const counts = {
      paid_not_transferred: unreconciled.length,
      ended_without_winner: endedSlots.length,
      paid_without_payment_intent: paidWithoutIntent.length,
    };

    const problems = [
      counts.paid_not_transferred,
      counts.ended_without_winner,
      counts.paid_without_payment_intent,
    ].filter((n) => n > 0).length;

    return {
      job: 'reconcile-payments',
      ran: true,
      counts,
      currency: cronCurrency(),
      note:
        problems === 0
          ? 'Reconciliation clean: no payment drift detected.'
          : `${problems} drift categor${problems === 1 ? 'y' : 'ies'} detected. See the admin reconciliation view.`,
    };
  });
}
