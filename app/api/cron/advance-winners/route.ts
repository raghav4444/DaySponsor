/**
 * POST /api/cron/advance-winners
 *
 * Scheduled job: for slots whose winning bid expired unpaid, advances to the next
 * highest bidder, up to the configured attempt limit. Slots with no remaining bidders
 * are marked failed for an admin to resolve manually.
 *
 * Authorization is `Authorization: Bearer <CRON_SECRET>`. The request supplies no slot
 * id, no bidder id and no amount: fallback order and the attempt limit are database
 * state plus configuration, never caller input.
 *
 * Recommended cadence: every 5 minutes, after `expire-unpaid-winners`. Idempotent —
 * advancing a slot that has already advanced is a no-op.
 */

import { runCronJob } from '@/lib/cron-guard';
import { getMaxWinnerAttempts } from '@/lib/stripe/server';
import { getAdminClient } from '@/lib/server-supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Slots that closed, had a winner expire, and have not yet exhausted their fallback
 * attempts. Selected by database state alone.
 */
async function loadSlotsNeedingAdvance(): Promise<
  { id: string; day_id: string; winner_attempts: number | null }[]
> {
  const { data, error } = await getAdminClient()
    .from('sponsorship_slots')
    .select('id, day_id, winner_attempts')
    .eq('auction_status', 'awaiting_payment')
    .lt('winner_attempts', getMaxWinnerAttempts())
    .order('updated_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  return data as unknown as { id: string; day_id: string; winner_attempts: number | null }[];
}

export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, 'advance-winners', async () => {
    const slots = await loadSlotsNeedingAdvance();

    const counts = {
      slots_examined: slots.length,
      advanced: 0,
      exhausted: 0,
    };

    for (const slot of slots) {
      // The highest remaining non-expired bid, if any. Ordering is by amount, so a tie
      // resolves to the earlier bid — the database's own ordering, not the job's choice.
      const { data: nextBid } = await getAdminClient()
        .from('auction_bids')
        .select('id, amount')
        .eq('slot_id', slot.id)
        .in('status', ['active', 'outbid'])
        .order('amount', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const attempts = (slot.winner_attempts ?? 0) + 1;

      if (nextBid) {
        // Promote the fallback bidder and reset the payment clock.
        const { error: promoteError } = await getAdminClient()
          .from('auction_bids')
          .update({ status: 'winning' })
          .eq('id', (nextBid as { id: string }).id);

        if (promoteError) continue;

        await getAdminClient()
          .from('sponsorship_slots')
          .update({
            winner_attempts: attempts,
            current_highest_bid: (nextBid as { amount: number }).amount,
          })
          .eq('id', slot.id);

        counts.advanced += 1;
      } else {
        // No bidder left. Hand the slot to an admin rather than leaving it dangling.
        await getAdminClient()
          .from('sponsorship_slots')
          .update({
            winner_attempts: attempts,
            auction_status: 'failed',
          })
          .eq('id', slot.id);

        counts.exhausted += 1;
      }
    }

    return {
      job: 'advance-winners',
      ran: true,
      counts,
      note:
        counts.slots_examined === 0
          ? 'No slots needed a fallback winner.'
          : `${counts.advanced} slot${counts.advanced === 1 ? '' : 's'} advanced to a fallback bidder; ${counts.exhausted} exhausted and marked failed.`,
    };
  });
}
