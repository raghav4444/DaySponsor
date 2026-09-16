/**
 * POST /api/cron/close-auctions
 *
 * Scheduled job: closes auctions whose `auction_ends_at` has passed.
 *
 * Authorization is `Authorization: Bearer <CRON_SECRET>` (see `lib/cron-guard.ts`).
 * The request body and query string are never read: which auctions to close is
 * decided by the database (`now() > auction_ends_at`), never by a caller. A user id
 * or amount in the request would be ignored, not honoured.
 *
 * Recommended cadence: every minute. The job is idempotent — a slot already closed is
 * not transitioned again — so overlapping or replayed runs are safe.
 */

import { runCronJob } from '@/lib/cron-guard';
import { closeExpiredAuctions } from '@/lib/auction-rpc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, 'close-auctions', async () => {
    const closed = await closeExpiredAuctions();

    return {
      job: 'close-auctions',
      ran: true,
      counts: { auctions_closed: closed },
      note:
        closed === 0
          ? 'No auctions were due to close.'
          : `${closed} auction${closed === 1 ? '' : 's'} closed.`,
    };
  });
}
