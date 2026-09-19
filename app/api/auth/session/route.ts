import { NextResponse } from 'next/server';
import { authenticateRequest, getProfileForUser } from '@/lib/server-supabase';

/**
 * Resolves the caller's user and profile from their `Authorization` token.
 *
 * The login page uses this to route a user to the dashboard that matches their real role
 * — the old code always sent everyone to `/dashboard/creator`, so brands landed on the
 * creator dashboard. It also lets the OAuth callback's client-side fallback confirm a
 * session after the redirect.
 *
 * Follows the same `Authorization` header convention as `app/api/dashboard/**`.
 */
export async function GET(request: Request) {
  const user = await authenticateRequest(request);

  if (!user) {
    return NextResponse.json(
      { user: null, profile: null },
      { status: 200 },
    );
  }

  const profile = await getProfileForUser(user.id);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email ?? null,
      userMetadata: user.user_metadata ?? null,
    },
    profile,
  });
}
