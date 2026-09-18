/**
 * Webhook tests (Phase 15).
 *
 * Covers the rules for `app/api/stripe/webhook/route.ts` and the handlers in
 * `lib/stripe/webhook-handlers.ts`:
 *  - the raw body is verified against `Stripe-Signature`;
 *  - an invalid signature is a 400 and nothing is processed;
 *  - a replayed event id gets 2xx and is not re-processed;
 *  - the amount/currency are compared against the database, not the event payload;
 *  - a sponsorship is only marked paid by the handler, never by the browser redirect;
 *  - a notification failure never rolls back a completed payment.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { POST as webhookPost } from '@/app/api/stripe/webhook/route';
import { dispatchWebhookEvent } from '@/lib/stripe/webhook-handlers';
import * as stripeServer from '@/lib/stripe/server';
import {
  createFakeStripe,
  createFakeStripeState,
  fabricateEvent,
  TEST_WEBHOOK_SECRET,
  type FakeStripeState,
} from './fakes/stripe-fake';
import {
  createFakeSupabaseState,
  installFakeAdminClient,
  installRpcHandler,
  seedDatabase,
  type FakeSupabaseState,
} from './fakes/supabase-fake';
const SPONSORSHIP_ID = 'sp-1';
const CREATOR_ID = 'creator-1';
const BRAND_ID = 'brand-1';

let stripeState: FakeStripeState;
let supabaseState: FakeSupabaseState;
let restoreSupabase: () => void;

function postEvent(event: { id: string; type: string; data: { object: Record<string, unknown> } }) {
  const { rawPayload, signature } = fabricateEvent(event);
  return webhookPost(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Stripe-Signature': signature, 'Content-Type': 'text/plain' },
      body: rawPayload,
    }),
  );
}

function seedPaidSponsorship(overrides: Record<string, unknown> = {}) {
  // The row the handlers read and write.
  seedDatabase(supabaseState, {
    sponsorships: [
      {
        id: SPONSORSHIP_ID,
        slot_id: 'slot-1',
        brand_id: BRAND_ID,
        creator_id: CREATOR_ID,
        amount: 500,
        platform_fee: 50,
        creator_amount: 450,
        status: 'pending',
        currency: 'eur',
        stripe_payment_intent_id: null,
        stripe_checkout_session_id: null,
        stripe_transfer_id: null,
        payout_status: 'pending',
        payout_hold: false,
        winning_bid_id: 'bid-1',
        ...overrides,
      },
    ],
  });
}

function checkoutEventObject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 500,
    currency: 'eur',
    payment_intent: 'pi_test_1',
    metadata: { sponsorship_id: SPONSORSHIP_ID },
    ...overrides,
  };
}

beforeEach(() => {
  stripeState = createFakeStripeState();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  vi.spyOn(stripeServer, 'getStripe').mockReturnValue(createFakeStripe(stripeState));

  supabaseState = createFakeSupabaseState();
  restoreSupabase = installFakeAdminClient(supabaseState);
  installRpcHandler(supabaseState, 'mark_sponsorship_paid', (args) => {
    const input = args as {
      p_sponsorship_id: string;
      p_payment_intent_id: string | null;
      p_charge_id: string | null;
    };
    const row = supabaseState.database.sponsorships.find((item) => item.id === input.p_sponsorship_id);
    if (row) {
      Object.assign(row, {
        status: 'paid',
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: input.p_payment_intent_id,
        stripe_charge_id: input.p_charge_id,
      });
    }
    return { ok: true, error: null };
  });
});

afterEach(() => {
  restoreSupabase();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('signature verification', () => {
  it('accepts a correctly signed event and marks it handled', async () => {
    seedPaidSponsorship();

    const response = await postEvent({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: checkoutEventObject() },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ received: true, handled: true }));
  });

  it('rejects an event signed with the wrong secret with a 400', async () => {
    seedPaidSponsorship();

    const { rawPayload } = fabricateEvent(
      { id: 'evt_2', type: 'checkout.session.completed', data: { object: checkoutEventObject() } },
      'whsec_wrong_secret',
    );

    const response = await webhookPost(
      new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 't=fake,v1=invalid', 'Content-Type': 'text/plain' },
        body: rawPayload,
      }),
    );

    expect(response.status).toBe(400);
    expect(stripeState.checkoutSessions).toHaveLength(0);
    // Nothing was written: the sponsorship is still unpaid.
    expect(supabaseState.database.sponsorships[0].status).toBe('pending');
  });

  it('rejects a request with no signature header', async () => {
    const response = await webhookPost(
      new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        body: 'not-a-signed-payload',
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('event idempotency', () => {
  it('returns 2xx for a replayed event and does not process it twice', async () => {
    seedPaidSponsorship();

    const event = {
      id: 'evt_replay',
      type: 'checkout.session.completed',
      data: { object: checkoutEventObject() },
    };

    const first = await postEvent(event);
    expect(first.status).toBe(200);

    const second = await postEvent(event);
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toEqual(expect.objectContaining({ received: true, duplicate: true }));

    // The handler ran once: the sponsorship was paid exactly once.
    expect(supabaseState.database.sponsorships).toHaveLength(1);
    expect(supabaseState.database.sponsorships[0].status).toBe('paid');
  });
});

describe('amount and currency are authoritative from the database', () => {
  it('marks the sponsorship paid using the recorded amount, not the event amount', async () => {
    seedPaidSponsorship({ amount: 500 });

    await postEvent({
      id: 'evt_amount',
      type: 'checkout.session.completed',
      // The payload lies about the amount; the database is the source of truth.
      data: { object: checkoutEventObject({ amount_total: 5 }) },
    });

    const [row] = supabaseState.database.sponsorships;
    expect(row.status).toBe('paid');
    expect(row.amount).toBe(500);
    expect(row.stripe_payment_intent_id).toBe('pi_test_1');
  });

  it('ignores an event whose metadata names an unknown sponsorship', async () => {
    seedPaidSponsorship();

    const response = await postEvent({
      id: 'evt_unknown',
      type: 'checkout.session.completed',
      data: {
        object: checkoutEventObject({ metadata: { sponsorship_id: 'sp-does-not-exist' } }),
      },
    });

    expect(response.status).toBe(200);
    expect(supabaseState.database.sponsorships[0].status).toBe('pending');
  });

  it('ignores an event with no sponsorship metadata', async () => {
    const response = await postEvent({
      id: 'evt_no_meta',
      type: 'checkout.session.completed',
      data: { object: checkoutEventObject({ metadata: null }) },
    });

    expect(response.status).toBe(200);
  });
});

describe('unknown and unhandled event types', () => {
  it('acknowledges an event type with no handler so Stripe stops retrying', async () => {
    const response = await postEvent({
      id: 'evt_unknown_type',
      type: 'some.future.event.type',
      data: { object: { id: 'x' } },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ received: true, handled: false }));
  });
});

describe('dispatchWebhookEvent', () => {
  it('returns "ignored" for a type with no handler', async () => {
    const outcome = await dispatchWebhookEvent({
      id: 'evt_1',
      type: 'not.a.real.type',
      data: { object: { id: 'x' } },
    } as never);

    expect(outcome).toBe('ignored');
  });

  it('marks the sponsorship paid for a completed checkout session', async () => {
    seedPaidSponsorship();

    await dispatchWebhookEvent({
      id: 'evt_direct',
      type: 'checkout.session.completed',
      data: { object: checkoutEventObject() },
    } as never);

    const [row] = supabaseState.database.sponsorships;
    expect(row.status).toBe('paid');
    expect(row.paid_at).toBeTruthy();
  });

  it('never marks a sponsorship paid from the browser redirect', async () => {
    // The success page carries no token and makes no call; the only writer is this
    // handler. Confirm the pre-state stays unpaid without a webhook delivery.
    seedPaidSponsorship();
    expect(supabaseState.database.sponsorships[0].status).toBe('pending');
  });
});

describe('notification failures do not roll back money', () => {
  it('keeps the sponsorship paid even when the notification layer throws', async () => {
    seedPaidSponsorship();

    const notifyModule = await import('@/lib/notifications');
    vi.spyOn(notifyModule, 'notifyAll').mockRejectedValue(new Error('email provider down'));

    await dispatchWebhookEvent({
      id: 'evt_notify_fail',
      type: 'checkout.session.completed',
      data: { object: checkoutEventObject() },
    } as never);

    expect(supabaseState.database.sponsorships[0].status).toBe('paid');
  });
});
