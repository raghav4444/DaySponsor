import Stripe from 'stripe';

/**
 * Server-only Stripe client.
 *
 * Guarantees required by the implementation brief:
 *  - The secret key is read only on the server.
 *  - The client is never imported into a browser component (enforced at runtime below,
 *    and by convention: only `app/api/**`, `lib/server-*`, and `lib/stripe/**` may import it).
 *  - The Stripe API version is pinned explicitly rather than floating with the SDK.
 *
 * Nothing in this module logs secrets, client secrets, card data, or webhook payloads.
 */

/**
 * Pinned Stripe API version.
 *
 * Matches the version bundled with the installed SDK (stripe@14.25.0 pins
 * 2023-10-16). Pinning here means a future SDK upgrade cannot silently change wire
 * behaviour — upgrading is a deliberate act: bump this constant in the same commit.
 */
export const STRIPE_API_VERSION = '2023-10-16' as const;

let stripeClient: Stripe | null = null;

/** True when running in a browser-like environment. */
function isBrowserEnvironment() {
  return typeof window !== 'undefined';
}

/**
 * Returns the shared server Stripe client.
 *
 * Throws if called in a browser (a programming error that would leak nothing, but
 * signals a bad import) or if the secret key is missing.
 */
export function getStripe(): Stripe {
  if (isBrowserEnvironment()) {
    throw new Error(
      'The Stripe server client must not be used in the browser. ' +
        'Call Stripe APIs from a server route instead.',
    );
  }

  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set. Set it in the server environment.');
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    // Keep the SDK from emitting noisy request logs that could contain payload data.
    telemetry: false,
    maxNetworkRetries: 2,
    timeout: 20_000,
    typescript: true,
  });

  return stripeClient;
}

/**
 * Whether Stripe is configured on the server. Used by routes that should degrade
 * gracefully (e.g. returning a clear 503) instead of throwing a 500.
 */
export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * The webhook signing secret. Read separately because it is only needed by the
 * webhook route, and must never be bundled with the general client.
 */
export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set. Set it in the server environment.');
  }
  return secret;
}

/** The public app URL, used to build Connect refresh/return and Checkout URLs. */
export function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  // Local development fallback only. Production must set NEXT_PUBLIC_APP_URL.
  return 'http://localhost:3000';
}

/**
 * Platform currency and fee configuration.
 *
 * The currency is fixed by configuration and never accepted from the client.
 * The fee is expressed in basis points so it can be applied with integer math.
 */
export function getPlatformConfig() {
  const feeBpsRaw = process.env.PLATFORM_FEE_BPS;
  const parsedBps = feeBpsRaw ? Number.parseInt(feeBpsRaw, 10) : 1000;
  const feeBps = Number.isFinite(parsedBps) && parsedBps >= 0 && parsedBps <= 10_000 ? parsedBps : 1000;

  return {
    currency: (process.env.PLATFORM_CURRENCY || 'eur').toLowerCase(),
    feeBps,
  } as const;
}

/** Payment deadline window for a winning bid, in hours. */
export function getPaymentDeadlineHours(): number {
  const raw = process.env.AUCTION_PAYMENT_DEADLINE_HOURS;
  const parsed = raw ? Number.parseInt(raw, 10) : 24;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

/** Maximum number of fallback winners to attempt per slot before expiring it. */
export function getMaxWinnerAttempts(): number {
  const raw = process.env.AUCTION_MAX_WINNER_ATTEMPTS;
  const parsed = raw ? Number.parseInt(raw, 10) : 3;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}