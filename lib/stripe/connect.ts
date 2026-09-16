import type Stripe from 'stripe';
import { getStripe, getAppUrl } from '@/lib/stripe/server';
import { withStripeError } from '@/lib/stripe/errors';
import { IdempotencyKeys } from '@/lib/stripe/idempotency';

/**
 * Stripe Connect (Express) helpers.
 *
 * The existing schema already carries `creator_profiles.stripe_account_id` (text) and
 * `stripe_onboarding_complete` (boolean), so no schema change is needed for the account
 * link itself — only for auctions. See `docs/database-change-requests.md`.
 *
 * Everything in this module is server-only and never returns secret values to a caller.
 */

/** Shape of Stripe's account requirements we care about, normalized. */
export type ConnectAccountStatus = {
  accountId: string;
  /** Stripe has everything it needs and can pay out. */
  payoutsEnabled: boolean;
  /** The creator finished the onboarding flow. */
  detailsSubmitted: boolean;
  /** Charges may be created and money routed to this account. */
  chargesEnabled: boolean;
  /** Requirement keys Stripe is currently waiting on. */
  currentlyDue: string[];
  /** Requirement keys that will be needed later. */
  eventuallyDue: string[];
  /** Past-due keys — these block the account. */
  pastDue: string[];
  /** Human-readable reason the account cannot receive transfers, if any. */
  disabledReason: string | null;
  /**
   * The single boolean the application stores in
   * `creator_profiles.stripe_onboarding_complete`.
   */
  onboardingComplete: boolean;
  /**
   * Whether this account may legally receive a transfer right now. This is the check the
   * checkout and payout paths both rely on.
   */
  canReceiveTransfers: boolean;
};

/**
 * Normalizes a Stripe Account object into the subset the application uses.
 *
 * Kept pure (no I/O) so it can be unit-tested directly against fabricated Account
 * shapes, which is how the "connected account validation" test in Phase 15 works.
 */
export function normalizeAccountStatus(account: Stripe.Account): ConnectAccountStatus {
  // Requirements are always present on a retrieved account; the nullish guards keep this
  // safe against fabricated/partial Account shapes used in unit tests.
  const requirements = (account.requirements ?? {}) as {
    currently_due?: string[] | null;
    eventually_due?: string[] | null;
    past_due?: string[] | null;
    disabled_reason?: string | null;
  };
  const currentlyDue = requirements.currently_due ?? [];
  const eventuallyDue = requirements.eventually_due ?? [];
  const pastDue = requirements.past_due ?? [];
  const disabledReason = requirements.disabled_reason ?? null;

  const detailsSubmitted = Boolean(account.details_submitted);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const chargesEnabled = Boolean(account.charges_enabled);

  // "Complete" means the creator finished onboarding: Stripe has the details and there
  // is nothing outstanding that blocks the account.
  const onboardingComplete =
    detailsSubmitted && pastDue.length === 0 && disabledReason === null;

  // Transfers additionally require payouts to be enabled — an account can be verified
  // but still restricted (e.g. a payout schedule or verification hold) and must not be
  // paid in that state.
  const canReceiveTransfers =
    onboardingComplete && payoutsEnabled && disabledReason === null;

  return {
    accountId: account.id,
    payoutsEnabled,
    detailsSubmitted,
    chargesEnabled,
    currentlyDue,
    eventuallyDue,
    pastDue,
    disabledReason,
    onboardingComplete,
    canReceiveTransfers,
  };
}

/** Creates a Stripe Express connected account for a creator. */
export async function createExpressAccount(params: {
  creatorProfileId: string;
  email?: string | null;
  countryCode?: string | null;
}): Promise<Stripe.Account> {
  return withStripeError('connect.createAccount', () =>
    getStripe().accounts.create(
      {
        type: 'express',
        email: params.email ?? undefined,
        country: params.countryCode || undefined,
        // Internal ids in metadata so a Stripe dashboard row maps back to a profile.
        metadata: {
          creator_profile_id: params.creatorProfileId,
        },
        capabilities: {
          transfers: { requested: true },
        },
      },
      // Stable per creator: a retried request returns the same account, never a second.
      { idempotencyKey: IdempotencyKeys.connectAccountForCreator(params.creatorProfileId) },
    ),
  );
}

/** Retrieves an account and normalizes its status. Returns null if the account is gone. */
export async function retrieveAccountStatus(
  accountId: string,
): Promise<ConnectAccountStatus | null> {
  try {
    const account = await withStripeError('connect.retrieveAccount', () =>
      getStripe().accounts.retrieve(accountId),
    );
    return normalizeAccountStatus(account);
  } catch {
    // A deleted/unknown account id is a normal, recoverable condition.
    return null;
  }
}

/**
 * Creates a single-use Account Link for onboarding.
 *
 * The refresh URL returns the creator to the dashboard where they can retry; the return
 * URL is where Stripe sends them when onboarding finishes.
 */
export async function createAccountLink(params: {
  accountId: string;
  flowToken?: string;
}): Promise<string> {
  const appUrl = getAppUrl();
  const refreshUrl = `${appUrl}/dashboard/creator?stripe=refresh`;
  const returnUrl = `${appUrl}/dashboard/creator?stripe=return`;

  const link = await withStripeError('connect.createAccountLink', () =>
    getStripe().accountLinks.create(
      {
        account: params.accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
        collect: 'eventually_due',
      },
      // A short-lived flow token keeps repeated clicks from stacking links.
      {
        idempotencyKey: IdempotencyKeys.accountLinkForAccount(
          params.accountId,
          params.flowToken ?? String(Math.floor(Date.now() / 300_000)),
        ),
      },
    ),
  );

  // Return only the safe hosted URL — never the account object or any secret.
  return link.url;
}

/**
 * Creates a login link to the creator's Express dashboard.
 * Only valid once the account has completed onboarding.
 */
export async function createDashboardLoginLink(accountId: string): Promise<string> {
  const link = await withStripeError('connect.createLoginLink', () =>
    getStripe().accounts.createLoginLink(accountId),
  );
  return link.url;
}

/**
 * Whether the given Connect account is eligible to receive a transfer.
 * Used by the checkout precondition and again by the payout release guard.
 */
export async function isAccountEligibleForTransfers(accountId: string | null) {
  if (!accountId) return false;
  const status = await retrieveAccountStatus(accountId);
  return Boolean(status?.canReceiveTransfers);
}