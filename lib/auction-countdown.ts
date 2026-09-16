/**
 * Auction countdown.
 *
 * Rules from the brief:
 *  - The countdown is **visual only**. Server/database time stays authoritative.
 *  - When the countdown reaches zero the client **refetches** rather than declaring a
 *    winner, because the closing job — not the browser — transitions an auction.
 *
 * This module is pure: given `now` and the end time it returns a display value and the
 * "has it elapsed" flag. Keeping it free of React lets the countdown tests assert on
 * numbers instead of timers.
 */

export type Countdown = {
  /** "2h 14m", "14m 30s", "30s", or "Auction ended" when elapsed. */
  label: string;
  /** Whole milliseconds remaining, clamped at zero. */
  remainingMs: number;
  /** True when the end time has passed. */
  elapsed: boolean;
  /** True when less than a minute remains. */
  urgent: boolean;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Formats a remaining duration as a compact countdown.
 *
 * 0 → "Auction ended", <1min → seconds only, <1h → minutes+seconds, else hours+minutes.
 * A duration longer than a day shows days too, because a creator can list a slot well
 * ahead of its day.
 */
export function formatCountdown(endsAt: string | null, now = Date.now()): Countdown {
  if (!endsAt) {
    return { label: '—', remainingMs: 0, elapsed: false, urgent: false };
  }

  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) {
    return { label: '—', remainingMs: 0, elapsed: false, urgent: false };
  }

  const remaining = end - now;

  if (remaining <= 0) {
    return { label: 'Auction ended', remainingMs: 0, elapsed: true, urgent: false };
  }

  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  const seconds = Math.floor((remaining % MINUTE) / 1000);

  let label: string;
  if (days > 0) {
    label = `${days}d ${hours}h`;
  } else if (hours > 0) {
    label = `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    label = `${minutes}m ${seconds}s`;
  } else {
    label = `${seconds}s`;
  }

  return {
    label,
    remainingMs: remaining,
    elapsed: false,
    urgent: remaining < MINUTE,
  };
}
