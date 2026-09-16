'use client';

import { useEffect, useState } from 'react';
import { formatCountdown, type Countdown } from '@/lib/auction-countdown';

/**
 * Auction countdown hook.
 *
 * The countdown is decorative: it ticks once a second for display, and when it reaches
 * zero it calls `onElapsed` instead of concluding anything. The server remains the only
 * authority on whether an auction has closed — the closing RPC does that transition, not
 * the browser — so `onElapsed` is the cue to **refetch** slot state, never to mark a
 * winner locally.
 *
 * The interval is only mounted while the auction has not elapsed, so a page full of
 * closed auctions runs no timers.
 */
export function useCountdown(
  endsAt: string | null,
  onElapsed?: () => void,
  intervalMs = 1000,
): Countdown {
  const [countdown, setCountdown] = useState<Countdown>(() => formatCountdown(endsAt));

  useEffect(() => {
    // Recompute on prop change so a refetched end time is reflected immediately.
    setCountdown(formatCountdown(endsAt));

    if (!endsAt) return;

    const tick = () => {
      const next = formatCountdown(endsAt);
      setCountdown(next);
      if (next.elapsed) {
        clearInterval(timer);
        // Refetch, do not conclude. The closing job decides the winner.
        onElapsed?.();
      }
    };

    const timer = setInterval(tick, intervalMs);
    tick();

    return () => clearInterval(timer);
    // `onElapsed` is intentionally excluded: callers pass an inline closure, and
    // re-subscribing every render would reset the interval and miss the elapsed edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, intervalMs]);

  return countdown;
}
