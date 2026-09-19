import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/server-supabase';
import { requireCreator, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { createAccountLink, createExpressAccount } from '@/lib/stripe/connect';
import { isStripeConfigured } from '@/lib/stripe/server';

/**
 * POST /api/stripe/connect/account-link
 *
 * Returns a single-use Stripe-hosted onboarding URL for the authenticated creator.
 *
 * If the creator has no connected account yet, one is created first, so the UI only ever
 * needs this one call. Only the hosted URL is returned — never the account object.
 */
export async function POST(request: Request) {
  if (!isPost(request)) return errorResponse('Method not allowed.', 405, 'method_not_allowed');
  if (!isStripeConfigured()) {
    return errorResponse(
      'Stripe test mode is not configured. Add STRIPE_SECRET_KEY=sk_test_... to .env and restart the server.',
      503,
      'not_configured',
    );
  }

  const { profile, creatorProfile, error } = await requireCreator(request);
  if (error) return error;

  try {
    let accountId = creatorProfile.stripe_account_id ?? null;

    if (!accountId) {
      const account = await createExpressAccount({
        creatorProfileId: creatorProfile.id,
        email: profile.email,
        countryCode: creatorProfile.country_code || null,
      });
      accountId = account.id;

      const { error: updateError } = await getAdminClient()
        .from('creator_profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', creatorProfile.id);

      if (updateError) throw updateError;
    }

    // A per-request flow token keeps rapid repeated clicks from stacking up links.
    const url = await createAccountLink({ accountId, flowToken: crypto.randomUUID() });

    return NextResponse.json({ url });
  } catch (thrown) {
    return handleRouteError('connect.createAccountLink', thrown);
  }
}