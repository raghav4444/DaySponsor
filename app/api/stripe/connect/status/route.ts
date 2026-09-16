import { NextResponse } from 'next/server';
import { requireCreator, handleRouteError, errorResponse } from '@/lib/stripe/api-helpers';
import { retrieveAccountStatus } from '@/lib/stripe/connect';
import { getAdminClient } from '@/lib/server-supabase';

/**
 * GET /api/stripe/connect/status
 *
 * Reports whether the authenticated creator can receive payouts.
 *
 * Reads the live status from Stripe and refreshes the cached
 * `stripe_onboarding_complete` flag. The response contains only derived booleans and
 * requirement keys — never the account object, secrets, or capability tokens.
 */
export async function GET(request: Request) {
  if (request.method.toUpperCase() !== 'GET') {
    return errorResponse('Method not allowed.', 405, 'method_not_allowed');
  }

  const { creatorProfile, error } = await requireCreator(request);
  if (error) return error;

  try {
    if (!creatorProfile.stripe_account_id) {
      return NextResponse.json({
        hasAccount: false,
        onboardingComplete: false,
        canReceiveTransfers: false,
        payoutsEnabled: false,
        currentlyDue: [],
        pastDue: [],
        disabledReason: null,
      });
    }

    const status = await retrieveAccountStatus(creatorProfile.stripe_account_id);

    if (!status) {
      // The stored account is gone. Report as not-connected rather than erroring, so
      // the UI can offer a fresh onboarding flow.
      return NextResponse.json({
        hasAccount: false,
        onboardingComplete: false,
        canReceiveTransfers: false,
        payoutsEnabled: false,
        currentlyDue: [],
        pastDue: [],
        disabledReason: 'account_unavailable',
      });
    }

    // Refresh the cached flag so dashboard reads do not depend on a live Stripe call.
    // A failed cache write must not fail the status response.
    const { error: cacheError } = await getAdminClient()
      .from('creator_profiles')
      .update({ stripe_onboarding_complete: status.onboardingComplete })
      .eq('id', creatorProfile.id);

    if (cacheError) {
      console.error('[connect.status] failed to refresh onboarding cache', {
        creator_profile_id: creatorProfile.id,
      });
    }

    return NextResponse.json({
      hasAccount: true,
      onboardingComplete: status.onboardingComplete,
      canReceiveTransfers: status.canReceiveTransfers,
      payoutsEnabled: status.payoutsEnabled,
      currentlyDue: status.currentlyDue,
      pastDue: status.pastDue,
      disabledReason: status.disabledReason,
    });
  } catch (thrown) {
    return handleRouteError('connect.retrieveAccount', thrown);
  }
}