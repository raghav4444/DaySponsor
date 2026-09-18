import { cn } from '@/lib/utils';
import type {
  AuctionStatus,
  BidStatus,
  PayoutStatus,
  RefundStatus,
} from '@/lib/auction-types';

/**
 * Shared status → label + colour mapping.
 *
 * The three dashboards each had their own inline `statusConfig`. This is the single
 * source of truth for the auction statuses, so a slot reads the same colour in the brand
 * dashboard, the creator dashboard, and the admin dashboard.
 *
 * Palette discipline (design.md): accent green-teal for positive states, neutral greys
 * for pending/informational, and `destructive` reserved exclusively for failure and money
 * returned to the brand. No second saturated colour is introduced.
 */

type StatusStyle = { label: string; color: string };

const AUCTION_STATUS: Record<AuctionStatus, StatusStyle> = {
  draft: { label: 'Draft', color: 'bg-secondary text-muted-foreground' },
  open: { label: 'Open', color: 'bg-accent/10 text-accent' },
  closed: { label: 'Closed', color: 'bg-secondary text-muted-foreground' },
  awaiting_payment: { label: 'Awaiting payment', color: 'bg-amber-500/10 text-amber-600' },
  paid: { label: 'Paid', color: 'bg-accent/10 text-accent' },
  completed: { label: 'Completed', color: 'bg-accent/10 text-accent' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive' },
};

const BID_STATUS: Record<BidStatus, StatusStyle> = {
  active: { label: 'Active', color: 'bg-accent/10 text-accent' },
  outbid: { label: 'Outbid', color: 'bg-amber-500/10 text-amber-600' },
  winner: { label: 'Winner', color: 'bg-accent/10 text-accent' },
  payment_pending: { label: 'Payment required', color: 'bg-amber-500/10 text-amber-600' },
  paid: { label: 'Paid', color: 'bg-accent/10 text-accent' },
  cancelled: { label: 'Cancelled', color: 'bg-secondary text-muted-foreground' },
  failed: { label: 'Failed', color: 'bg-destructive/10 text-destructive' },
};

const PAYOUT_STATUS: Record<PayoutStatus, StatusStyle> = {
  pending: { label: 'Payout pending', color: 'bg-amber-500/10 text-amber-600' },
  eligible: { label: 'Eligible', color: 'bg-accent/10 text-accent' },
  released: { label: 'Payout released', color: 'bg-accent/10 text-accent' },
  failed: { label: 'Payout failed', color: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Payout cancelled', color: 'bg-secondary text-muted-foreground' },
};

const REFUND_STATUS: Record<RefundStatus, StatusStyle> = {
  none: { label: 'No refund', color: 'bg-secondary text-muted-foreground' },
  pending: { label: 'Refund pending', color: 'bg-amber-500/10 text-amber-600' },
  succeeded: { label: 'Refunded', color: 'bg-destructive/10 text-destructive' },
  failed: { label: 'Refund failed', color: 'bg-destructive/10 text-destructive' },
  canceled: { label: 'Refund cancelled', color: 'bg-secondary text-muted-foreground' },
};

/**
 * The sponsorship lifecycle statuses already existed before the auction work; they are
 * repeated here (not re-exported from a dashboard page) so the auction components never
 * import a page module.
 */
const SPONSORSHIP_STATUS: Record<string, StatusStyle> = {
  pending: { label: 'Pending', color: 'bg-amber-500/10 text-amber-600' },
  payment_failed: { label: 'Payment failed', color: 'bg-destructive/10 text-destructive' },
  payment_expired: { label: 'Payment expired', color: 'bg-secondary text-muted-foreground' },
  paid: { label: 'Paid', color: 'bg-blue-500/10 text-blue-600' },
  product_shipped: { label: 'Shipped', color: 'bg-blue-500/10 text-blue-600' },
  product_received: { label: 'Received', color: 'bg-blue-500/10 text-blue-600' },
  day_completed: { label: 'Day done', color: 'bg-accent/10 text-accent' },
  review_pending: { label: 'Review pending', color: 'bg-amber-500/10 text-amber-600' },
  completed: { label: 'Completed', color: 'bg-accent/10 text-accent' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive' },
  refunded: { label: 'Refunded', color: 'bg-destructive/10 text-destructive' },
};

export function auctionStatusStyle(status: AuctionStatus): StatusStyle {
  return AUCTION_STATUS[status] ?? { label: status, color: 'bg-secondary text-muted-foreground' };
}
export function bidStatusStyle(status: BidStatus): StatusStyle {
  return BID_STATUS[status] ?? { label: status, color: 'bg-secondary text-muted-foreground' };
}
export function payoutStatusStyle(status: PayoutStatus): StatusStyle {
  return PAYOUT_STATUS[status] ?? { label: status, color: 'bg-secondary text-muted-foreground' };
}
export function refundStatusStyle(status: RefundStatus): StatusStyle {
  return REFUND_STATUS[status] ?? { label: status, color: 'bg-secondary text-muted-foreground' };
}
export function sponsorshipStatusStyle(status: string): StatusStyle {
  return SPONSORSHIP_STATUS[status] ?? { label: status, color: 'bg-secondary text-muted-foreground' };
}

type StatusBadgeProps = {
  status: string | null | undefined;
  kind?: 'auction' | 'bid' | 'payout' | 'refund' | 'sponsorship';
  className?: string;
};

/**
 * Renders a status pill. `kind` selects which vocabulary the status belongs to; an
 * unknown or missing value degrades to a neutral pill rather than throwing, because a
 * status string the frontend has not learned yet must never break a dashboard.
 */
export function StatusBadge({ status, kind = 'sponsorship', className }: StatusBadgeProps) {
  const value = status ?? 'unknown';
  const style =
    kind === 'auction'
      ? auctionStatusStyle(value as AuctionStatus)
      : kind === 'bid'
        ? bidStatusStyle(value as BidStatus)
        : kind === 'payout'
          ? payoutStatusStyle(value as PayoutStatus)
          : kind === 'refund'
            ? refundStatusStyle(value as RefundStatus)
            : sponsorshipStatusStyle(value);

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
        style.color,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
