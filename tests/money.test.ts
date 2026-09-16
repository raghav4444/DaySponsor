import { describe, it, expect } from 'vitest';
import {
  splitPlatformFee,
  minimumNextBid,
  isValidBidAmount,
  parseMajorUnitsToMinor,
  formatMinorUnits,
} from '@/lib/money';

describe('splitPlatformFee', () => {
  it('splits an amount so the parts sum exactly to the gross', () => {
    const result = splitPlatformFee(450, 1000);
    expect(result.platformFee).toBe(45);
    expect(result.creatorAmount).toBe(405);
    expect(result.platformFee + result.creatorAmount).toBe(450);
  });

  it('rounds the fee down so the platform never takes more than its share', () => {
    // 455 * 10% = 45.5 -> floor(45) -> creator gets the remainder
    const result = splitPlatformFee(455, 1000);
    expect(result.platformFee).toBe(45);
    expect(result.creatorAmount).toBe(410);
    expect(result.platformFee + result.creatorAmount).toBe(455);
  });

  it('supports a zero-fee configuration', () => {
    const result = splitPlatformFee(500, 0);
    expect(result.platformFee).toBe(0);
    expect(result.creatorAmount).toBe(500);
  });

  it('throws on non-integer money', () => {
    expect(() => splitPlatformFee(45.5, 1000)).toThrow(/non-negative integer/);
  });

  it('throws on an out-of-range fee', () => {
    expect(() => splitPlatformFee(450, 20_000)).toThrow(/basis points/);
  });
});

describe('minimumNextBid', () => {
  it('is the starting price plus the increment when nobody has bid', () => {
    expect(minimumNextBid(0, 400, 50)).toBe(450);
  });

  it('is the current high bid plus the increment once bidding is live', () => {
    expect(minimumNextBid(450, 400, 50)).toBe(500);
  });
});

describe('isValidBidAmount', () => {
  it('accepts a bid above the minimum', () => {
    expect(isValidBidAmount(500, 450, 400)).toBe(true);
  });

  it('rejects a bid below the current high bid', () => {
    expect(isValidBidAmount(400, 450, 400)).toBe(false);
  });

  it('rejects a fractional amount', () => {
    expect(isValidBidAmount(450.5, 400, 400)).toBe(false);
  });

  it('rejects a non-number', () => {
    expect(isValidBidAmount('450', 400, 400)).toBe(false);
  });
});

describe('parseMajorUnitsToMinor', () => {
  it('parses a decimal euro string into minor units', () => {
    expect(parseMajorUnitsToMinor('4.50')).toBe(450);
  });

  it('parses a whole euro string', () => {
    expect(parseMajorUnitsToMinor('450')).toBe(45_000);
  });

  it('parses a comma decimal separator', () => {
    expect(parseMajorUnitsToMinor('4,50')).toBe(450);
  });

  it('pads a single decimal digit', () => {
    expect(parseMajorUnitsToMinor('4.5')).toBe(450);
  });

  it('rejects malformed input', () => {
    expect(parseMajorUnitsToMinor('abc')).toBeNull();
    expect(parseMajorUnitsToMinor('')).toBeNull();
    expect(parseMajorUnitsToMinor('4.501')).toBeNull();
    expect(parseMajorUnitsToMinor('-5')).toBeNull();
  });
});

describe('formatMinorUnits', () => {
  it('formats minor units as a currency string', () => {
    expect(formatMinorUnits(450, 'eur')).toBe('€4.50');
  });

  it('formats thousands with grouping', () => {
    expect(formatMinorUnits(50_000, 'eur')).toBe('€500.00');
  });

  it('falls back instead of throwing on an unknown currency', () => {
    expect(formatMinorUnits(450, 'not-a-currency')).toContain('4.50');
  });
});
