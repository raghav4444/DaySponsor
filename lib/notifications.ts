import { getAdminClient } from '@/lib/server-supabase';
import type { NotificationType } from '@/lib/auction-types';

/**
 * Persistent notification helper.
 *
 * The existing in-app mechanism is shadcn toast + sonner, which is ephemeral. This adds
 * the persistent record (contract §3.5) that the dashboards can read and the browser can
 * surface as toast.
 *
 * Hard rule: **notification failure must never roll back a successful financial
 * transaction.** Every caller invokes `notify()` *after* the database commit and never
 * `await`s it on a payment-critical path. The `UNIQUE (recipient_id, type, related_id)`
 * constraint makes retries safe (a webhook replay does not spam the user).
 */

/** Copy for each notification type. Centralized so tone stays consistent. */
const NOTIFICATION_COPY: Record<
  NotificationType,
  { title: string; body: string }
> = {
  bid_accepted: {
    title: 'Bid accepted',
    body: 'Your bid is currently the highest.',
  },
  outbid: {
    title: "You've been outbid",
    body: 'Someone placed a higher bid. Bid again to stay in front.',
  },
  auction_ended: {
    title: 'Auction ended',
    body: 'Bidding has closed for this slot.',
  },
  winner_selected: {
    title: 'Winner selected',
    body: 'Your bid won. Payment is now required.',
  },
  payment_required: {
    title: 'Payment required',
    body: 'Complete payment to secure your sponsorship.',
  },
  payment_expiring: {
    title: 'Payment expiring soon',
    body: 'Your winning bid will expire if payment is not completed.',
  },
  payment_successful: {
    title: 'Payment successful',
    body: 'Your sponsorship is confirmed.',
  },
  product_shipped: {
    title: 'Product shipped',
    body: 'The brand has shipped the product to you.',
  },
  product_received: {
    title: 'Product received',
    body: 'The creator confirmed they received the product.',
  },
  review_pending: {
    title: 'Review pending',
    body: 'A review is waiting to be written or published.',
  },
  review_published: {
    title: 'Review published',
    body: 'Your honest review is now live.',
  },
  payout_released: {
    title: 'Payout released',
    body: 'Your earnings have been sent to your Stripe account.',
  },
  refund_completed: {
    title: 'Refund completed',
    body: 'The sponsorship has been refunded.',
  },
  fallback_selected: {
    title: 'Fallback winner selected',
    body: 'The previous winner did not pay, so the next bidder was selected.',
  },
};

export type NotificationInput = {
  recipientId: string;
  type: NotificationType;
  href?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  /** Override the default body, e.g. to include an amount. */
  body?: string | null;
};

/**
 * Writes a persistent notification.
 *
 * Fire-and-forget by design: returns a promise the caller may ignore. Never throws —
 * a notification failure is logged, not propagated, so it cannot break a payment flow.
 */
export async function notify(input: NotificationInput): Promise<void> {
  const copy = NOTIFICATION_COPY[input.type];

  try {
    await getAdminClient().from('notifications').upsert(
      {
        recipient_id: input.recipientId,
        type: input.type,
        title: copy.title,
        body: input.body ?? copy.body,
        href: input.href ?? null,
        related_type: input.relatedType ?? null,
        related_id: input.relatedId ?? null,
        read_at: null,
      },
      // Re-inserting an unread notification keeps it unread instead of duplicating.
      { onConflict: 'recipient_id,type,related_id', ignoreDuplicates: true },
    );
  } catch (error) {
    // Deliberately swallowed: never roll back a financial transaction over this.
    console.error('[notifications] failed to record notification', {
      type: input.type,
      recipient_id: input.recipientId,
      error_message: error instanceof Error ? error.message : 'unknown error',
    });
  }
}

/**
 * Records several notifications. Used where a single event affects two parties
 * (e.g. payment success notifies both the winner and the creator).
 */
export function notifyAll(inputs: NotificationInput[]): Promise<void[]> {
  return Promise.all(inputs.map((input) => notify(input)));
}

/** Loads the unread notification count for a profile (badge in the navbar). */
export async function countUnreadNotifications(recipientId: string): Promise<number> {
  try {
    const { count, error } = await getAdminClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', recipientId)
      .is('read_at', null);

    if (error || count === null) return 0;
    return count;
  } catch {
    return 0;
  }
}