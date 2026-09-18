/**
 * POST /api/cron/expire-unpaid-winners
 *
 * Scheduled job: expires winning bids whose payment deadline passed without payment,
 * advancing the slot to the next-highest bidder (contract §4.2).
 *
 * Authorization is `Authorization: Bearer <CRON_SECRET>`. No ids or amounts are taken
 * from the request — the deadline and the fallback order both live in the database.
 *
 * Recommended cadence: every 5 minutes. Idempotent: a winner already expired is not
 * expired again, and a slot with no remaining bidders is marked failed for an admin.
 */

import { runCronJob } from '@/lib/cron-guard';
import { getAdminClient } from '@/lib/server-supabase';
import { expireUnpaidWinner } from '@/lib/auction-rpc';
import { getMaxWinnerAttempts } from '@/lib/stripe/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, 'expire-unpaid-winners', async () => {
    // The job discovers its own work from the database — the request body is never read.
    // Expire each slot whose winning bid has passed its payment deadline. Idempotent:
    // a winner already expired is not expired again.
    const { data, error } = await getAdminClient()
      .from('sponsorship_slots')
      .select('id')
      .eq('auction_status', 'awaiting_payment');
    if (error || !data) {
      return {
        job: 'expire-unpaid-winners',
        ran: true,
        counts: { winners_expired: 0 },
        note: 'No winners were past their payment deadline.',
      };
    }

    const maxAttempts = getMaxWinnerAttempts();
    let expired = 0;
    for (const slot of data) {
      try {
        await expireUnpaidWinner(slot.id as string, maxAttempts);
        expired += 1;
      } catch {
        // Already expired or terminal — safe to skip.
      }
    }

    return {
      job: 'expire-unpaid-winners',
      ran: true,
      counts: { winners_expired: expired },
      note:
        expired === 0
          ? 'No winners were past their payment deadline.'
          : `${expired} winner${expired === 1 ? '' : 's'} expired; fallback bidders advanced.`,
    };
  });
}
