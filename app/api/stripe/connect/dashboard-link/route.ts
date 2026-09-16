import { NextResponse } from 'next/server';
import {
  requireCreator,
  handleRouteError,
  isPost,
  errorResponse,
  conflictResponse,
} from '@/lib/stripe/api-helpers';
import { createDashboardLoginLink, retrieveAccountStatus } from '@/lib/stripe/connect';

/**
 * POST /api/stripe/connect/dashboard-link
 *
 * Returns a one-time Stripe Express dashboard login URL for the authenticated creator.
 *
 * Only valid once onboarding is complete — Stripe rejects login links for accounts that
 * still have outstanding requirements, so we check first and return a clear 409 instead
 * of surfacing a Stripe error to the UI.
 */
export async function POST(request: Request) {
  if (!isPost(request)) return errorResponse('Method not allowed.', 405, 'method_not_allowed');

  const { creatorProfile, error } = await requireCreator(request);
  if (error) return error;

  if (!creatorProfile.stripe_account_id) {
    return conflictResponse('Connect your Stripe account before opening the dashboard.');
  }

  try {
    const status = await retrieveAccountStatus(creatorProfile.stripe_account_id);
    if (!status?.onboardingComplete) {
      return conflictResponse('Finish your Stripe onboarding to open the dashboard.');
    }

    const url = await createDashboardLoginLink(creatorProfile.stripe_account_id);
    return NextResponse.json({ url });
  } catch (thrown) {
    return handleRouteError('connect.createLoginLink', thrown);
  }
}