import { NextResponse } from 'next/server';
import { requireBrand, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { placeBid } from '@/lib/auction-rpc';
import { PLACE_BID_ERROR_MESSAGES } from '@/lib/auction-types';
import { parseMajorUnitsToMinor } from '@/lib/money';

/**
 * POST /api/auction/bids
 *
 * Authenticated server wrapper around Engineer A's atomic `place_bid` RPC.
 *
 * The browser sends a slot id and a major-unit bid string. The server:
 *  - authenticates the brand;
 *  - converts the amount to integer minor units itself, so the client never supplies a
 *    currency or a pre-rounded number;
 *  - delegates the atomic placement (lock, re-check, demote the prior leader, commit) to
 *    the RPC.
 *
 * The response carries the new current highest bid so an outbid conflict can be shown to
 * the user immediately. It never carries another brand's identity.
 */
export async function POST(request: Request) {
  if (!isPost(request)) return errorResponse('Method not allowed.', 405, 'method_not_allowed');

  const { profile, error } = await requireBrand(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid request body.', 400, 'invalid_body');
  }

  const slotId = takeOptionalString(body, 'slotId');
  if (!slotId) return errorResponse('A slot id is required.', 400, 'missing_slot');

  // The client sends a display amount ("450" or "4.50"). Minor-unit conversion happens
  // here, never in the browser, so rounding and currency can never be client-side.
  const rawAmount = body.amount;
  const amount =
    typeof rawAmount === 'number'
      ? rawAmount
      : typeof rawAmount === 'string'
        ? parseMajorUnitsToMinor(rawAmount)
        : null;

  if (amount === null || !Number.isInteger(amount) || amount <= 0) {
    return errorResponse('Enter a valid bid amount.', 400, 'invalid_amount');
  }

  try {
    const result = await placeBid({ slotId, brandProfileId: profile.id, amount });

    if (result.error_code) {
      const message = PLACE_BID_ERROR_MESSAGES[result.error_code] ?? 'Your bid could not be placed.';
      const conflict =
        result.error_code === 'bid_too_low' || result.error_code === 'auction_ended';
      // A conflict returns the live current bid so the client can update its display
      // instead of silently rejecting the same number again.
      return NextResponse.json(
        {
          error: message,
          code: result.error_code,
          currentHighestBid: result.current_highest_bid,
          auctionEndsAt: result.auction_ends_at,
        },
        { status: conflict ? 409 : 400 },
      );
    }

    return NextResponse.json({
      bidId: result.bid_id,
      status: result.status,
      currentHighestBid: result.current_highest_bid,
      auctionEndsAt: result.auction_ends_at,
    });
  } catch (thrown) {
    return handleRouteError('auction.placeBid', thrown);
  }
}

function takeOptionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
