import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import {
  authenticateRequest,
  getProfileForUser,
  getProfileWithCreator,
} from '@/lib/server-supabase';
import type { Profile, CreatorProfile } from '@/lib/supabase';
import { StripeOperationError, withStripeError } from '@/lib/stripe/errors';

/**
 * Shared helpers for Stripe route handlers.
 *
 * These exist so every route follows the same auth convention as the existing
 * `app/api/dashboard/**` routes — Authorization header → verified user → profile —
 * while adding the "resolve the brand/creator profile server-side" step that financial
 * routes require.
 */

/** Standard JSON error response. Never includes secrets. */
export function errorResponse(
  message: string,
  statusCode = 400,
  code = 'invalid_request',
) {
  return NextResponse.json({ error: message, code }, { status: statusCode });
}

export function unauthorizedResponse() {
  return errorResponse('Sign in to continue.', 401, 'unauthenticated');
}

export function forbiddenResponse(message = 'You are not allowed to do that.') {
  return errorResponse(message, 403, 'forbidden');
}

export function notFoundResponse(message = 'Not found.') {
  return errorResponse(message, 404, 'not_found');
}

export function conflictResponse(message: string) {
  return errorResponse(message, 409, 'conflict');
}

/**
 * Resolves the authenticated user from the request.
 * Returns the Supabase user, or an error response the handler can return as-is.
 */
export async function requireUser(request: Request): Promise<
  | { user: User; error: null }
  | { user: null; error: NextResponse }
> {
  const user = await authenticateRequest(request);
  if (!user) return { user: null, error: unauthorizedResponse() };
  return { user, error: null };
}

/**
 * Resolves the authenticated user **and** their profile.
 * Rejects requests with no profile row (a user that has not completed signup).
 */
export async function requireProfile(request: Request): Promise<
  | { user: User; profile: Profile; error: null }
  | { user: null; profile: null; error: NextResponse }
> {
  const resolved = await requireUser(request);
  if (resolved.error) return { user: null, profile: null, error: resolved.error };

  const profile = await getProfileForUser(resolved.user.id);
  if (!profile) {
    return {
      user: null,
      profile: null,
      error: errorResponse('Complete your profile to continue.', 403, 'no_profile'),
    };
  }

  return { user: resolved.user, profile, error: null };
}

/**
 * Resolves the authenticated user and asserts the profile role is `brand`.
 */
export async function requireBrand(request: Request): Promise<
  | { user: User; profile: Profile; error: null }
  | { user: null; profile: null; error: NextResponse }
> {
  const resolved = await requireProfile(request);
  if (resolved.error) return resolved;
  if (resolved.profile.role !== 'brand') {
    return { user: null, profile: null, error: forbiddenResponse('A brand account is required.') };
  }
  return resolved;
}

/**
 * Resolves the authenticated user and asserts the profile role is `creator`.
 * Also loads the creator profile row (which holds `stripe_account_id`).
 */
export async function requireCreator(request: Request): Promise<
  | {
      user: User;
      profile: Profile;
      creatorProfile: CreatorProfile;
      error: null;
    }
  | { user: null; profile: null; creatorProfile: null; error: NextResponse }
> {
  const resolved = await requireProfile(request);
  if (resolved.error) {
    return { user: null, profile: null, creatorProfile: null, error: resolved.error };
  }
  if (resolved.profile.role !== 'creator') {
    return {
      user: null,
      profile: null,
      creatorProfile: null,
      error: forbiddenResponse('A creator account is required.'),
    };
  }

  const { profile, creatorProfile } = await getProfileWithCreator(resolved.user.id);
  if (!profile || !creatorProfile) {
    return {
      user: null,
      profile: null,
      creatorProfile: null,
      error: errorResponse('Creator profile not found.', 404, 'no_creator_profile'),
    };
  }

  return { user: resolved.user, profile, creatorProfile, error: null };
}

/**
 * Asserts the profile role is `admin`. Mirrors the check in
 * `app/api/dashboard/admin/users/route.ts:6-29`.
 */
export async function requireAdmin(request: Request): Promise<
  | { user: User; profile: Profile; error: null }
  | { user: null; profile: null; error: NextResponse }
> {
  const resolved = await requireProfile(request);
  if (resolved.error) return resolved;
  if (resolved.profile.role !== 'admin') {
    return { user: null, profile: null, error: forbiddenResponse('Admin access required.') };
  }
  return resolved;
}

/**
 * Runs a route operation and converts any thrown error into a safe JSON response.
 * Catches `StripeOperationError` (already normalized) and anything unexpected.
 */
export async function handleRouteError(operation: string, error: unknown) {
  if (error instanceof StripeOperationError) {
    return NextResponse.json(error.toJson(), { status: error.statusCode });
  }

  // Unexpected: normalize so nothing internal leaks.
  const wrapped = await withStripeError(operation, async () => {
    throw error;
  }).catch((normalized) => normalized);

  return NextResponse.json(
    (wrapped as StripeOperationError).toJson(),
    { status: (wrapped as StripeOperationError).statusCode },
  );
}

/** True when the request is a POST. */
export function isPost(request: Request) {
  return request.method.toUpperCase() === 'POST';
}