/**
 * TEMPORARY application-level auction types.
 *
 * ️ DELETE THIS FILE once Engineer A merges the generated Supabase database types.
 *
 * The repository has no generated `Database` types, and the auction schema is not yet
 * migrated (see `docs/database-change-requests.md`). Everything here is hand-written to
 * match `docs/auction-implementation-contract.md` exactly, so that when the migration
 * lands, the only change needed is to swap these type aliases for the generated ones and
 * delete this file.
 *
 * Keeping the surface small and centralized means no other file has to change.
 */

// ─── Status unions (mirror the CHECK constraints in the contract) ────────────

export type AuctionStatus =
  | 'not_listed'
  | 'open'
  | 'closing'
  | 'awaiting_payment'
  | 'payment_pending'
  | 'sold'
  | 'expired'
  | 'cancelled';

export type BidStatus =
  | 'pending'
  | 'winning'
  | 'outbid'
  | 'won'
  | 'lost'
  | 'payment_pending'
  | 'payment_failed'
  | 'expired';

export type PayoutStatus =
  | 'none'
  | 'pending'
  | 'released'
  | 'failed'
  | 'reversed'
  | 'on_hold';

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

/** Auction fields added to `sponsorship_slots` (contract §3.1). */
export type SlotAuctionFields = {
  starting_price: number;
  auction_ends_at: string | null;
  auction_status: AuctionStatus;
  current_highest_bid: number;
  current_highest_bidder_id: string | null;
  bid_count: number;
  winner_attempts: number;
  currency: string;
};

/** A `auction_bids` row (contract §3.2). */
export type AuctionBid = {
  id: string;
  slot_id: string;
  brand_id: string;
  creator_id: string;
  amount: number;
  currency: string;
  status: BidStatus;
  stripe_checkout_session_id: string | null;
  payment_deadline_at: string | null;
  placed_at: string;
};

/** Payment/payout/refund fields added to `sponsorships` (contract §3.3). */
export type SponsorshipPaymentFields = {
  winning_bid_id: string | null;
  /** Gross amount charged, integer minor units. */
  amount: number;
  /** Platform fee, integer minor units. `amount - platform_fee === creator_amount`. */
  platform_fee: number;
  /** Creator's share, integer minor units. */
  creator_amount: number;
  currency: string;
  payment_deadline_at: string | null;
  paid_at: string | null;
  stripe_transfer_id: string | null;
  payout_status: PayoutStatus;
  payout_released_at: string | null;
  stripe_refund_id: string | null;
  refund_status: RefundStatus;
  payout_hold: boolean;
  payout_hold_reason: string | null;
};

/** A `webhook_events` row (contract §3.4). */
export type WebhookEventRecord = {
  id: string;
  stripe_event_id: string;
  stripe_account_id: string | null;
  event_type: string;
  api_version: string | null;
  status: WebhookEventStatus;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
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

// ─── RPC parameter/return shapes (contract §4) ────────────────────────────────

/** Error codes returned by `place_bid` (contract §4.1). */
export type PlaceBidErrorCode =
  | 'auction_not_open'
  | 'auction_ended'
  | 'bid_too_low'
  | 'own_slot'
  | 'not_brand_role'
  | 'slot_unavailable'
  | 'deadline_passed';

export type PlaceBidResult = {
  bid_id: string | null;
  status: BidStatus | null;
  current_highest_bid: number | null;
  previous_bidder_id: string | null;
  auction_ends_at: string | null;
  error_code: PlaceBidErrorCode | null;
};

/** Return shape of the payment-state RPCs (contract §4.3). */
export type PaymentMutationResult = {
  ok: boolean;
  error_code: string | null;
};

/**
 * Human-readable messages for `place_bid` failures.
 *
 * The client shows these directly, so they must be actionable and must never blame the
 * user for a race they could not have avoided.
 */
export const PLACE_BID_ERROR_MESSAGES: Record<PlaceBidErrorCode, string> = {
  auction_not_open: 'This auction is not open for bidding yet.',
  auction_ended: 'This auction has ended.',
  bid_too_low: 'Your bid is below the current highest bid.',
  own_slot: 'You cannot bid on your own day.',
  not_brand_role: 'Only brand accounts can place bids.',
  slot_unavailable: 'This slot is no longer available.',
  deadline_passed: 'The bidding deadline for this slot has passed.',
};