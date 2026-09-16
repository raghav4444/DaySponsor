import { createHash } from 'node:crypto';

/**
 * Stripe idempotency key generation.
 *
 * Every financial creation operation (Checkout Session, Transfer, Refund, Account Link)
 * carries a stable key derived from internal ids. This makes retried requests safe:
 * Stripe returns the original response instead of creating a second object.
 *
 * Keys must be stable for the same logical operation and unique per logical operation:
 *  - `checkout:session` for a winning bid is keyed on the bid id, so re-submitting the
 *    same bid returns the same Checkout Session instead of double-charging.
 *  - transfers are keyed on the sponsorship id, so a retried payout cannot pay twice.
 *
 * Keys are opaque hashes: they never contain an amount, a currency, or a secret.
 */

const MAX_KEY_LENGTH = 255;

function hash(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Builds a stable idempotency key.
 *
 * @param kind   the operation class, e.g. 'checkout', 'transfer', 'refund'
 * @param id     the internal id of the thing being operated on (bid/sponsorship id)
 * @param extra  optional additional stable qualifiers (never amounts/currencies)
 */
export function idempotencyKey(kind: string, id: string, extra?: string) {
  const raw = extra ? `${kind}|${id}|${extra}` : `${kind}|${id}`;
  const key = hash(raw).slice(0, 32);

  if (key.length > MAX_KEY_LENGTH) {
    // Defensive: sha256 hex is always 64 chars, so this is unreachable.
    throw new Error(`Generated idempotency key exceeds Stripe's ${MAX_KEY_LENGTH}-character limit.`);
  }

  return key;
}

/**
 * Idempotency keys used across the payment lifecycle.
 *
 * Centralized so that a key can never drift between the route that creates an object
 * and the code that retries it.
 */
export const IdempotencyKeys = {
  /** Checkout Session for a winning bid. Stable per bid. */
  checkoutForBid: (bidId: string) => idempotencyKey('checkout', bidId),

  /**
   * Checkout Session for a sponsorship. Stable per sponsorship + client flow token, so a
   * retried checkout returns the same session instead of double-charging.
   */
  checkoutSession: (sponsorshipId: string, flowToken: string) =>
    idempotencyKey('checkout', sponsorshipId, flowToken),

  /** Creator payout transfer. Stable per sponsorship. */
  transferForSponsorship: (sponsorshipId: string) =>
    idempotencyKey('transfer', sponsorshipId),

  /** Refund of a charge. Stable per sponsorship + charge. */
  refundForSponsorship: (sponsorshipId: string, chargeId: string) =>
    idempotencyKey('refund', sponsorshipId, chargeId),

  /** Reversal of a transfer. Stable per transfer. */
  reversalForTransfer: (transferId: string) => idempotencyKey('reversal', transferId),

  /** Stripe Express connected account for a creator. Stable per creator profile. */
  connectAccountForCreator: (creatorProfileId: string) =>
    idempotencyKey('account', creatorProfileId),

  /** Single-use Account Link for onboarding. Stable per account + refresh flow. */
  accountLinkForAccount: (accountId: string, flowToken: string) =>
    idempotencyKey('account-link', accountId, flowToken),
} as const;
