/**
 * POST /api/cron/retry-payouts
 *
 * Scheduled job: pays creators whose sponsorship is paid but not yet transferred.
 *
 * Authorization is `Authorization: Bearer <CRON_SECRET>`. The request supplies no
 * sponsorship id and no amount: the candidate list comes from the database, and every
 * amount paid is the `creator_amount` recorded when the fee was split — never a value
 * from the request, and never recomputed from a review.
 *
 * Being a candidate is not sufficient to transfer. `releasePayout` re-runs all eight
 * preconditions per sponsorship, and the Stripe call is idempotent per sponsorship, so
 * a replayed or overlapping run cannot pay a creator twice.
 *
 * Recommended cadence: every 15 minutes.
 */

import { runCronJob } from '@/lib/cron-guard';
import { loadPayoutCandidates, PAYOUT_BATCH_LIMIT } from '@/lib/cron-queries';
import { releasePayout } from '@/lib/stripe/payouts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, 'retry-payouts', async () => {
    const candidates = await loadPayoutCandidates();

    const counts = {
      candidates: candidates.length,
      transferred: 0,
      skipped: 0,
      failed: 0,
    };

    // Process serially. A burst of transfers is not worth racing the Stripe rate limit,
    // and serial processing keeps one failure from aborting the rest.
    for (const candidate of candidates.slice(0, PAYOUT_BATCH_LIMIT)) {
      try {
        const result = await releasePayout(candidate.id);
        if (result.transferred) {
          counts.transferred += 1;
        } else {
          // A blocked precondition is the normal outcome for a candidate that was
          // refunded or put on hold after the list was built. It is a skip, not a failure.
          counts.skipped += 1;
        }
      } catch {
        // A Stripe error on one row must not stop the rest. The row stays un-transferred
        // and is retried on the next run; the count tells the scheduler something hit.
        counts.failed += 1;
      }
    }

    return {
      job: 'retry-payouts',
      ran: true,
      counts,
      note:
        counts.transferred === 0 && counts.candidates === 0
          ? 'No payouts were due.'
          : `${counts.transferred} payout${counts.transferred === 1 ? '' : 's'} released, ${counts.skipped} skipped, ${counts.failed} failed.`,
    };
  });
}
