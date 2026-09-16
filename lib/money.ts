/**
 * Money helpers.
 *
 * All amounts in DaySponsor are integer minor units (e.g. 450 = €4.50), matching the
 * database columns `amount integer`, `platform_fee integer`, `creator_amount integer`
 * and the auction contract's `bigint` fields.
 *
 * Rules enforced here:
 *  - Never use floating point for money. Division uses basis points with integer math.
 *  - The fee is always deducted from the total, so the two parts always sum back exactly.
 *  - The client never supplies a currency; formatting only reads one.
 */

/** Platform fee in basis points (1000 bps = 10%). Server-configurable. */
export const DEFAULT_PLATFORM_FEE_BPS = 1000;

/**
 * Splits a gross amount (minor units) into platform fee and creator amount using
 * integer math. The remainder always belongs to the creator, so
 * `fee + creatorAmount === gross` for every input.
 */
export function splitPlatformFee(grossMinorUnits: number, feeBps = DEFAULT_PLATFORM_FEE_BPS) {
  if (!Number.isInteger(grossMinorUnits) || grossMinorUnits < 0) {
    throw new Error('Amount must be a non-negative integer in minor units.');
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error('Fee basis points must be an integer between 0 and 10000.');
  }

  // Math.floor keeps the platform's cut from ever exceeding the configured percentage;
  // the creator receives the remainder, so the parts sum exactly to the gross.
  const platformFee = Math.floor((grossMinorUnits * feeBps) / 10_000);
  const creatorAmount = grossMinorUnits - platformFee;

  return { platformFee, creatorAmount, gross: grossMinorUnits } as const;
}

/**
 * Computes the minimum acceptable next bid.
 *
 * A bid must exceed the current highest bid; if there are no bids the starting price is
 * the minimum. The increment prevents a race of ±1 minor-unit sniping.
 */
export function minimumNextBid(
  currentHighestBid: number,
  startingPrice: number,
  incrementMinorUnits = 50,
) {
  const base = currentHighestBid > 0 ? currentHighestBid : startingPrice;
  return base + incrementMinorUnits;
}

/** True when the given amount is a valid bid for the slot. */
export function isValidBidAmount(
  amount: unknown,
  currentHighestBid: number,
  startingPrice: number,
  incrementMinorUnits = 50,
): amount is number {
  return (
    typeof amount === 'number' &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount >= minimumNextBid(currentHighestBid, startingPrice, incrementMinorUnits)
  );
}

/**
 * Parses a user-entered major-unit string ("450.50", "450,50", "450") into integer
 * minor units. Used only for the bid input; the server still re-validates the result.
 *
 * Returns null when the input is not a well-formed amount, so callers can show a
 * validation message instead of submitting NaN.
 */
export function parseMajorUnitsToMinor(input: string, exponent = 2): number | null {
  const trimmed = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!trimmed) return null;
  // Reject anything that is not an optional-sign decimal number.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > exponent) return null;

  const paddedFraction = fraction.padEnd(exponent, '0');
  const minorUnits = Number.parseInt(`${whole}${paddedFraction}`, 10);

  if (!Number.isSafeInteger(minorUnits)) return null;
  return minorUnits;
}

/**
 * Formats integer minor units for display, e.g. 450 + 'eur' -> "€4.50".
 *
 * Uses Intl so locale-correct grouping and symbol placement are handled for us. Falls
 * back to a manual format if the runtime rejects the currency code, so a bad currency
 * value can never crash a dashboard.
 */
export function formatMinorUnits(
  amount: number,
  currency = 'eur',
  locale = 'en-IE', // EU locale so EUR renders as €4.50 rather than €4.5
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const major = safeAmount / 100;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}