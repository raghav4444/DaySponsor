/**
 * Payout tests (Phase 15).
 *
 * Covers the hard rules for `lib/stripe/payouts.ts`:
 *  - all eight preconditions gate the transfer;
 *  - the transfer is for exactly the recorded `creator_amount`;
 *  - the review rating never changes the payout;
 *  - a duplicate release cannot pay the creator twice;
 *  - the transfer is a separate transfer tied by `transfer_group`, never a destination
 *    charge, and the sponsorship is only marked paid after Stripe confirms.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { releasePayout, validatePayout } from '@/lib/stripe/payouts';
import * as stripeServer from '@/lib/stripe/server';
import {
  createFakeStripe,
  createFakeStripeState,
  type FakeStripeState,
} from './fakes/stripe-fake';
import {
  createFakeSupabaseState,
  installFakeAdminClient,
  installRpcHandler,
  seedDatabase,
  type FakeSupabaseState,
} from './fakes/supabase-fake';

const CREATOR_ID = 'creator-1';
const BRAND_ID = 'brand-1';
const CONNECTED_ACCOUNT_ID = 'acct_connected';

let stripeState: FakeStripeState;
let supabaseState: FakeSupabaseState;
let restoreSupabase: () => void;

function seedWithSponsorship(overrides: Record<string, unknown> = {}) {
  seedDatabase(supabaseState, {
    sponsorships: [
      {
        id: 'sp-1',
        slot_id: 'slot-1',
        brand_id: BRAND_ID,
        creator_id: CREATOR_ID,
        amount: 500,
        platform_fee: 50,
        creator_amount: 450,
        status: 'paid',
        currency: 'eur',
        stripe_payment_intent_id: 'pi_existing',
        stripe_transfer_id: null,
        payout_status: 'pending',
        payout_released_at: null,
        stripe_refund_id: null,
        payout_hold: false,
        payout_hold_reason: null,
        winning_bid_id: 'bid-1',
        ...overrides,
      },
    ],
    creator_profiles: [
      {
        id: CREATOR_ID,
        profile_id: CREATOR_ID,
        stripe_account_id: CONNECTED_ACCOUNT_ID,
        stripe_onboarding_complete: true,
      },
    ],
  });
}

beforeEach(() => {
  stripeState = createFakeStripeState();
  // The platform's Stripe client is a cached singleton; replace it for this suite.
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
  vi.spyOn(stripeServer, 'getStripe').mockReturnValue(createFakeStripe(stripeState));

  supabaseState = createFakeSupabaseState();
  restoreSupabase = installFakeAdminClient(supabaseState);
  stripeState.accounts.set(CONNECTED_ACCOUNT_ID, {
    id: CONNECTED_ACCOUNT_ID,
    type: 'express',
    details_submitted: true,
    payouts_enabled: true,
    charges_enabled: true,
    requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null },
  });
  installRpcHandler(supabaseState, 'release_payout', (args) => {
    const input = args as { p_sponsorship_id: string; p_transfer_id: string };
    const row = supabaseState.database.sponsorships.find((item) => item.id === input.p_sponsorship_id);
    if (row) {
      Object.assign(row, {
        stripe_transfer_id: input.p_transfer_id,
        payout_status: 'released',
        payout_released_at: new Date().toISOString(),
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

describe('releasePayout: the happy path', () => {
  it('transfers exactly the recorded creator amount, minor units', async () => {
    seedWithSponsorship({ creator_amount: 450 });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(true);
    expect(result.transferId).toBeTruthy();

    expect(stripeState.transfers).toHaveLength(1);
    const [transfer] = stripeState.transfers;
    expect(transfer.amount).toBe(450);
    expect(transfer.currency).toBe('eur');
    expect(transfer.destination).toBe(CONNECTED_ACCOUNT_ID);
  });

  it('ties the transfer to the platform charge by transfer_group, not a destination charge', async () => {
    seedWithSponsorship();

    await releasePayout('sp-1');

    const [transfer] = stripeState.transfers;
    expect(transfer.transfer_group).toBe('sponsorship_sp-1');
    // A destination charge would have no separate transfer at all; a separate transfer
    // from the platform charge is what this row is.
    expect(transfer.metadata?.sponsorship_id).toBe('sp-1');
  });

  it('records the transfer and marks the payout released only after Stripe returns an id', async () => {
    seedWithSponsorship();

    const result = await releasePayout('sp-1');
    expect(result.transferId).toMatch(/^tr_test/);

    const [row] = supabaseState.database.sponsorships;
    expect(row.stripe_transfer_id).toBe(result.transferId);
    expect(row.payout_status).toBe('released');
    expect(row.payout_released_at).toBeTruthy();
  });
});

describe('releasePayout: a different creator amount produces a different transfer', () => {
  it('never transfers the gross charge amount', async () => {
    seedWithSponsorship({ amount: 500, platform_fee: 50, creator_amount: 450 });

    await releasePayout('sp-1');

    expect(stripeState.transfers[0].amount).toBe(450);
    expect(stripeState.transfers[0].amount).not.toBe(500);
  });

  it('never derives the amount from the review rating', async () => {
    // A 1-star review and a 5-star review must produce the same payout. The payout
    // modules never read the review, so seeding a rating changes nothing here.
    seedWithSponsorship({ creator_amount: 450 });
    seedDatabase(supabaseState, {
      ...supabaseState.database,
      reviews: [
        { id: 'r1', sponsorship_id: 'sp-1', rating: 1 },
      ],
    });

    const low = await releasePayout('sp-1');

    expect(low.transferred).toBe(true);
    expect(stripeState.transfers[0].amount).toBe(450);
  });
});

describe('releasePayout: precondition gating', () => {
  it('does not pay a sponsorship that was never charged', async () => {
    seedWithSponsorship({ status: 'pending' });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('sponsorship_paid');
    expect(stripeState.transfers).toHaveLength(0);
  });

  it('does not pay a refunded sponsorship', async () => {
    seedWithSponsorship({ refund_status: 'succeeded', stripe_refund_id: 're_1' });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('not_refunded');
    expect(stripeState.transfers).toHaveLength(0);
  });

  it('does not pay a sponsorship with a pending refund', async () => {
    seedWithSponsorship({ stripe_refund_id: 're_pending' });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('not_refunded');
  });

  it('does not pay a sponsorship already paid out', async () => {
    seedWithSponsorship({ payout_status: 'released', stripe_transfer_id: 'tr_old' });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('not_already_paid_out');
    // The original transfer is untouched, and no second transfer is created.
    expect(stripeState.transfers).toHaveLength(0);
    expect(supabaseState.database.sponsorships[0].stripe_transfer_id).toBe('tr_old');
  });

  it('does not pay a sponsorship an admin has put on hold', async () => {
    seedWithSponsorship({ payout_hold: true, payout_hold_reason: 'Dispute open' });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('not_on_hold');
    expect(result.validation.checks.find((c) => !c.ok)?.reason).toBe('Dispute open');
  });

  it('does not pay when the creator has no connected account', async () => {
    seedWithSponsorship();
    seedDatabase(supabaseState, {
      ...supabaseState.database,
      creator_profiles: [{ id: CREATOR_ID, profile_id: CREATOR_ID, stripe_account_id: null }],
    });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('creator_connected_and_eligible');
  });

  it('does not pay when the recorded creator amount is not positive', async () => {
    seedWithSponsorship({ creator_amount: 0 });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('creator_amount_positive');
  });

  it('does not pay when the charge has not succeeded', async () => {
    seedWithSponsorship({ stripe_payment_intent_id: null });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    expect(result.validation.blocking).toBe('charge_succeeded');
  });

  it('reports the first failure when several preconditions would fail', async () => {
    seedWithSponsorship({ status: 'pending', payout_hold: true });

    const result = await releasePayout('sp-1');

    expect(result.transferred).toBe(false);
    // Precedence: payment is checked before the hold.
    expect(result.validation.blocking).toBe('sponsorship_paid');
  });
});

describe('releasePayout: idempotency', () => {
  it('does not create a second transfer when called twice', async () => {
    seedWithSponsorship({ creator_amount: 450 });

    await releasePayout('sp-1');
    // A replay of the same job re-reads the row; the recorded state now blocks a repeat.
    const second = await releasePayout('sp-1');

    expect(second.transferred).toBe(false);
    expect(stripeState.transfers).toHaveLength(1);
    expect(stripeState.transfers[0].amount).toBe(450);
  });
});

describe('validatePayout', () => {
  it('is a read-only check that reports every precondition', async () => {
    seedWithSponsorship();

    const validation = await validatePayout('sp-1');

    expect(validation.ok).toBe(true);
    expect(validation.blocking).toBeNull();
    expect(validation.checks.every((c) => c.ok)).toBe(true);
    expect(validation.checks.map((c) => c.precondition)).toContain('not_on_hold');
  });

  it('does not create a transfer', async () => {
    seedWithSponsorship();

    await validatePayout('sp-1');

    expect(stripeState.transfers).toHaveLength(0);
    expect(supabaseState.database.sponsorships[0].payout_status).toBe('pending');
  });
});
