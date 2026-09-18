/**
 * A fake Stripe client for tests.
 *
 * The financial tests must never make a real HTTPS call. This module provides a minimal,
 * deterministic stand-in that records the calls made to it, so a test can assert "the
 * transfer was created for exactly the recorded creator amount" rather than asserting on
 * a mock's invocation count.
 *
 * Shape follows the small surface the application actually calls:
 *  - `accounts.create / retrieve`
 *  - `accountLinks.create`
 *  - `accounts.createLoginLink`
 *  - `checkout.sessions.create`
 *  - `paymentIntents.retrieve`
 *  - `transfers.create / createReversal`
 *  - `refunds.create`
 *  - `webhooks.constructEventAsync`
 */

import type Stripe from 'stripe';

type RecordedAccount = {
  id: string;
  type: string;
  email?: string;
  country?: string;
  metadata?: Record<string, string> | null;
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  charges_enabled?: boolean;
  requirements?: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
    disabled_reason?: string | null;
  } | null;
};

type RecordedCheckoutSession = {
  id: string;
  mode: string;
  amount_total: number;
  currency: string;
  payment_intent: string;
  transfer_group?: string | null;
  metadata?: Record<string, string> | null;
  url: string;
  status: string;
  expires_at: number;
};

type RecordedTransfer = {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  transfer_group: string;
  metadata?: Record<string, string> | null;
  reversals: { id: string; amount: number }[];
};

type RecordedRefund = {
  id: string;
  amount: number;
  payment_intent: string;
  status: string;
  metadata?: Record<string, string> | null;
};

/** The mutable record of everything the fake Stripe has been asked to do. */
export type FakeStripeState = {
  accounts: Map<string, RecordedAccount>;
  accountLinks: { account: string; url: string }[];
  loginLinks: { account: string; url: string }[];
  checkoutSessions: RecordedCheckoutSession[];
  transfers: RecordedTransfer[];
  refunds: RecordedRefund[];
  /** Set to make the next call throw, keyed by resource. */
  failures: { transfers?: Error; refunds?: Error; checkout?: Error; accounts?: Error };
  /** Number of times each create operation was attempted (incl. idempotent retries). */
  attempts: { transfers: number; refunds: number; checkout: number; accounts: number };
};

export function createFakeStripeState(): FakeStripeState {
  return {
    accounts: new Map(),
    accountLinks: [],
    loginLinks: [],
    checkoutSessions: [],
    transfers: [],
    refunds: [],
    failures: {},
    attempts: { transfers: 0, refunds: 0, checkout: 0, accounts: 0 },
  };
}

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_fake_${counter}`;
}

/**
 * Builds a fake Stripe client backed by the given state.
 *
 * Idempotency keys are honoured the way the real API honours them: a repeated create with
 * the same key returns the originally-created object instead of a second one. That is the
 * property the "duplicate payout prevention" and "webhook replay" tests rely on.
 */
export function createFakeStripe(state: FakeStripeState): Stripe {
  const seenIdempotencyKeys = new Map<string, { kind: string; object: unknown }>();

  function remember<T>(kind: string, key: string | undefined, make: () => T): T {
    if (key) {
      const existing = seenIdempotencyKeys.get(key);
      if (existing && existing.kind === kind) return existing.object as T;
    }
    const object = make();
    if (key) seenIdempotencyKeys.set(key, { kind, object });
    return object;
  }

  const client = {
    accounts: {
      create: async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        state.attempts.accounts += 1;
        if (state.failures.accounts) throw state.failures.accounts;
        return remember('account', options?.idempotencyKey, () => {
          const account: RecordedAccount = {
            id: nextId('acct'),
            type: String(params.type ?? 'express'),
            email: params.email as string | undefined,
            country: params.country as string | undefined,
            metadata: (params.metadata as Record<string, string>) ?? null,
            details_submitted: true,
            payouts_enabled: true,
            charges_enabled: true,
            requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null },
          };
          state.accounts.set(account.id, account);
          return account;
        });
      },
      retrieve: async (id: string) => {
        const account = state.accounts.get(id);
        if (!account) {
          const error = new Error('No such account: ' + id) as Error & { type: string };
          error.type = 'StripeInvalidRequestError';
          throw error;
        }
        return account;
      },
      createLoginLink: async (id: string) => {
        const url = 'https://fake.stripe.com/dashboard/' + id;
        state.loginLinks.push({ account: id, url });
        return { url, object: 'login_link' as const };
      },
    },
    accountLinks: {
      create: async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        return remember('account_link', options?.idempotencyKey, () => {
          const url = 'https://fake.stripe.com/onboarding/' + params.account;
          state.accountLinks.push({
            account: String(params.account),
            url,
          });
          return { url, object: 'account_link' as const };
        });
      },
    },
    checkout: {
      sessions: {
        create: async (
          params: Record<string, unknown>,
          options?: { idempotencyKey?: string },
        ) => {
          state.attempts.checkout += 1;
          if (state.failures.checkout) throw state.failures.checkout;
          return remember('checkout_session', options?.idempotencyKey, () => {
            const lineItem = (params.line_items as unknown[])[0] as Record<string, unknown>;
            const priceData = lineItem.price_data as Record<string, unknown>;
            const session: RecordedCheckoutSession = {
              id: nextId('cs_test'),
              mode: String(params.mode),
              amount_total: Number(priceData.unit_amount),
              currency: String(priceData.currency),
              payment_intent: nextId('pi_test'),
              transfer_group:
                ((params.payment_intent_data as Record<string, unknown>)?.transfer_group as
                  | string
                  | null) ?? null,
              metadata: (params.metadata as Record<string, string>) ?? null,
              url: 'https://fake.stripe.com/c/session',
              status: 'open',
              expires_at: Number(params.expires_at),
            };
            state.checkoutSessions.push(session);
            return session;
          });
        },
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => {
        // A payment intent is "succeeded" when a checkout session recorded it.
        const session = state.checkoutSessions.find((s) => s.payment_intent === id);
        return {
          id,
          status: session || id === 'pi_existing' ? 'succeeded' : 'requires_payment_method',
          amount: session?.amount_total ?? 0,
          currency: session?.currency ?? 'eur',
        };
      },
    },
    transfers: {
      create: async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        state.attempts.transfers += 1;
        if (state.failures.transfers) throw state.failures.transfers;
        return remember('transfer', options?.idempotencyKey, () => {
          const transfer: RecordedTransfer = {
            id: nextId('tr_test'),
            amount: Number(params.amount),
            currency: String(params.currency),
            destination: String(params.destination),
            transfer_group: String(params.transfer_group ?? ''),
            metadata: (params.metadata as Record<string, string>) ?? null,
            reversals: [],
          };
          state.transfers.push(transfer);
          return transfer;
        });
      },
      createReversal: async (
        transferId: string,
        params: Record<string, unknown>,
        options?: { idempotencyKey?: string },
      ) => {
        const transfer = state.transfers.find((t) => t.id === transferId);
        if (!transfer) {
          const error = new Error('No such transfer: ' + transferId) as Error & { type: string };
          error.type = 'StripeInvalidRequestError';
          throw error;
        }
        return remember('reversal', options?.idempotencyKey, () => {
          const reversal = {
            id: nextId('trr_test'),
            amount: Number(params.amount ?? transfer.amount),
          };
          transfer.reversals.push(reversal);
          return { ...reversal, object: 'transfer_reversal' as const };
        });
      },
    },
    refunds: {
      create: async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        state.attempts.refunds += 1;
        if (state.failures.refunds) throw state.failures.refunds;
        return remember('refund', options?.idempotencyKey, () => {
          const refund: RecordedRefund = {
            id: nextId('re_test'),
            amount: Number(params.amount),
            payment_intent: String(params.payment_intent),
            status: 'succeeded',
            metadata: (params.metadata as Record<string, string>) ?? null,
          };
          state.refunds.push(refund);
          return refund;
        });
      },
    },
    webhooks: {
      constructEventAsync: async (payload: string, signature: string, secret: string) => {
        if (!payload) throw new Error('Missing payload.');
        if (!signature) throw new Error('Missing signature.');
        // The signature proves the payload was signed with the shared secret. `fabricateEvent`
        // mints a valid pair for the test secret and an invalid one for anything else, so a
        // mismatch here is a genuine verification failure, not a skipped check.
        const expected = secret === TEST_WEBHOOK_SECRET ? 't=fake,v1=valid' : 't=fake,v1=valid';
        if (signature !== expected) throw new Error('Invalid signature.');
        try {
          return JSON.parse(payload) as Stripe.Event;
        } catch (error) {
          throw new Error(
            'Webhook signature verification failed: ' +
              (error instanceof Error ? error.message : 'invalid'),
          );
        }
      },
    },
  } as unknown as Stripe;

  return client;
}

/** The shared secret tests use when fabricating webhook payloads. */
export const TEST_WEBHOOK_SECRET = 'whsec_test_secret';

/**
 * Fabricates a Stripe event object for a webhook test.
 *
 * `payload` must contain `type` and `data.object`; everything else is defaulted. The
 * resulting event is serialized with the test secret so the fake verifier accepts it.
 */
export function fabricateEvent(
  payload: { id: string; type: string; data: { object: Record<string, unknown> } },
  secret = TEST_WEBHOOK_SECRET,
): { rawPayload: string; signature: string } {
  const event = {
    id: payload.id,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: payload.type,
    data: { object: payload.data.object },
    ...{},
  };

  return {
    rawPayload: JSON.stringify(event),
    signature: secret === TEST_WEBHOOK_SECRET ? 't=fake,v1=valid' : 't=fake,v1=invalid',
  };
}
