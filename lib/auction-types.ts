/**
 * Application-level auction types.
 *
 * These mirror `docs/auction-implementation-contract.md` exactly, which in turn mirrors
 * the merged Engineer A migrations (`supabase/migrations/20260916*`). The repository has
 * no generated `Database` types (no Supabase CLI, no `types/database.d.ts`), so these
 * hand-written aliases are the typed seam the rest of the app imports from.
 *
 * Table names: `bids` (NOT `auction_bids`), `stripe_webhook_events`
 * (NOT `webhook_events`). Status vocabularies match the CHECK constraints in
 * `20260916000001` / `20260916000002`.
 */

// ─── Status unions (mirror the CHECK constraints in the migrations) ────────────

export type AuctionStatus =
  | 'draft'
  | 'open'
  | 'closed'
  | 'awaiting_payment'
  | 'paid'
  | 'completed'
  | 'cancelled';

export type BidStatus =
  | 'active'
  | 'outbid'
  | 'winner'
  | 'payment_pending'
  | 'paid'
  | 'cancelled'
  | 'failed';

/**
 * `cancelled` was added by migration `20260916000008` (a refund must never pay out, and
 * "cancelled" is a different claim from "failed" — nothing was attempted). Keep in sync
 * with `sponsorships_payout_status_check`.
 */
export type PayoutStatus =
  | 'pending'
  | 'eligible'
  | 'released'
  | 'failed'
  | 'cancelled';

export type SponsorshipStatus =
  | 'pending'
  | 'payment_pending'
  | 'paid'
  | 'product_shipped'
  | 'product_received'
  | 'day_completed'
  | 'review_pending'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type RefundStatus = 'none' | 'pending' | 'succeeded' | 'failed' | 'canceled';

export type WebhookEventStatus = 'pending' | 'processing' | 'processed' | 'failed';

/** Notification types — keep in sync with the contract (§7). */
export type NotificationType =
  | 'bid_accepted'
  | 'outbid'
  | 'auction_ended'
  | 'winner_selected'
  | 'payment_required'
  | 'payment_expiring'
  | 'payment_successful'
  | 'product_shipped'
  | 'product_received'
  | 'review_pending'
  | 'review_published'
  | 'payout_released'
  | 'refund_completed'
  | 'fallback_selected';

// ─── Row shapes ───────────────────────────────────────────────────────────────

/** Auction fields on `sponsorship_slots` (contract §1). */
export type SlotAuctionFields = {
  starting_price: number | null;
  auction_ends_at: string | null;
  auction_status: AuctionStatus;
  current_highest_bid: number | null;
  current_highest_bid_id: string | null;
  winning_bid_id: string | null;
  payment_due_at: string | null;
  closed_at: string | null;
  winner_attempt_count: number;
  currency: string;
};

/** A `bids` row (contract §1). */
export type AuctionBid = {
  id: string;
  slot_id: string;
  brand_id: string;
  amount: number;
  currency: string;
  status: BidStatus;
  created_at: string;
  updated_at: string;
};

/** Payment/payout/refund fields on `sponsorships` (contract §1). */
export type SponsorshipPaymentFields = {
  winning_bid_id: string | null;
  /** Gross amount charged, integer minor units. */
  amount: number;
  /** Platform fee, integer minor units. `amount - platform_fee === creator_amount`. */
  platform_fee: number;
  /** Creator's share, integer minor units. */
  creator_amount: number;
  currency: string;
  status: SponsorshipStatus;
  payment_status: PaymentStatus;
  payment_due_at: string | null;
  paid_at: string | null;
  refund_amount: number | null;
  refunded_at: string | null;
  stripe_charge_id: string | null;
  stripe_transfer_id: string | null;
  payout_status: PayoutStatus;
  payout_eligible_at: string | null;
  payout_released_at: string | null;
  stripe_refund_id: string | null;
  payout_hold: boolean;
  payout_hold_reason: string | null;
};

/** A `stripe_webhook_events` row (contract §1). */
export type WebhookEventRecord = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  resource_id: string | null;
  payload: Record<string, unknown>;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
};

/** A `notifications` row (contract §3.5). */
export type NotificationRecord = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  related_type: string | null;
  related_id: string | null;
  read_at: string | null;
  created_at: string;
};

// ─── RPC result shapes (contract §2) ────────────────────────────────────────────

/**
 * Deterministic `place_bid` error codes. The RPC returns (never raises) these inside
 * `{ ok: false, error }` so the caller can map them without parsing SQLSTATEs.
 */
export type PlaceBidErrorCode =
  | 'UNAUTHENTICATED'
  | 'BRAND_PROFILE_REQUIRED'
  | 'SLOT_NOT_FOUND'
  | 'AUCTION_NOT_OPEN'
  | 'AUCTION_ENDED'
  | 'INVALID_AMOUNT'
  | 'BELOW_STARTING_PRICE'
  | 'BID_TOO_LOW'
  | 'SELF_BID_FORBIDDEN'
  | 'AUCTION_FULL';

/** `open_auction` error codes. */
export type OpenAuctionErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_STARTING_PRICE'
  | 'INVALID_END_TIME'
  | 'UNSUPPORTED_CURRENCY'
  | 'SLOT_NOT_FOUND'
  | 'NOT_SLOT_OWNER'
  | 'AUCTION_NOT_DRAFT';

/** Successful `place_bid` payload (contract §2). */
export type PlaceBidResult = {
  ok: boolean;
  error: PlaceBidErrorCode | null;
  bid_id: string | null;
  slot_id: string | null;
  brand_id: string | null;
  amount: number | null;
  currency: string | null;
  status: BidStatus | null;
  is_leading: boolean | null;
  current_highest_bid: number | null;
  current_highest_bid_id: string | null;
  auction_status: AuctionStatus | null;
  auction_ends_at: string | null;
  previous_leader_outbid: boolean | null;
  // Context extras returned on specific failures.
  starting_price?: number | null;
};

/** Return shape of the payment-state RPCs (contract §2). */
export type PaymentMutationResult = {
  ok: boolean;
  error: string | null;
};

/**
 * Human-readable messages for `place_bid` failures.
 *
 * The client shows these directly, so they must be actionable and must never blame the
 * user for a race they could not have avoided.
 */
export const PLACE_BID_ERROR_MESSAGES: Record<PlaceBidErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in to place a bid.',
  BRAND_PROFILE_REQUIRED: 'Only brand accounts can place bids.',
  SLOT_NOT_FOUND: 'This slot no longer exists.',
  AUCTION_NOT_OPEN: 'This auction is not open for bidding yet.',
  AUCTION_ENDED: 'This auction has ended.',
  INVALID_AMOUNT: 'Enter a valid bid amount.',
  BELOW_STARTING_PRICE: 'Your bid is below the starting price.',
  BID_TOO_LOW: 'Your bid is below the current highest bid.',
  SELF_BID_FORBIDDEN: 'You cannot bid on your own day.',
  AUCTION_FULL: 'This slot already has a paying sponsorship.',
};