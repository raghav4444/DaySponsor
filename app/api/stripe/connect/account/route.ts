import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/server-supabase';
import { requireCreator, handleRouteError, isPost, errorResponse } from '@/lib/stripe/api-helpers';
import { createExpressAccount, retrieveAccountStatus } from '@/lib/stripe/connect';

/**
 * POST /api/stripe/connect/account
 *
 * Ensures the authenticated creator has an Express connected account.
 *
 * The account is created idempotently and the id is written with trusted server access —
 * the client never sees, sends, or chooses a Stripe account id. Calling this twice
 * returns the same account rather than creating a second one.
 */
export async function POST(request: Request) {
  if (!isPost(request)) return errorResponse('Method not allowed.', 405, 'method_not_allowed');

  const { profile, creatorProfile, error } = await requireCreator(request);
  if (error) return error;

  try {
    // Reuse the stored account when one exists, so repeated clicks are harmless.
    if (creatorProfile.stripe_account_id) {
      const status = await retrieveAccountStatus(creatorProfile.stripe_account_id);
      if (status) {
        return NextResponse.json({
          accountId: creatorProfile.stripe_account_id,
          created: false,
          onboardingComplete: status.onboardingComplete,
        });
      }
      // A deleted/unknown account id: fall through and create a replacement. The old id
      // is not cleared here — Engineer A's schema owns that column.
    }

    // Email comes from the authenticated profile, never from the request body.
    const account = await createExpressAccount({
      creatorProfileId: creatorProfile.id,
      email: profile.email,
      countryCode: creatorProfile.country_code || null,
    });

    const { error: updateError } = await getAdminClient()
      .from('creator_profiles')
      .update({ stripe_account_id: account.id })
      .eq('id', creatorProfile.id);

    if (updateError) throw updateError;

    return NextResponse.json(
      { accountId: account.id, created: true, onboardingComplete: false },
      { status: 201 },
    );
  } catch (thrown) {
    return handleRouteError('connect.createAccount', thrown);
  }
}