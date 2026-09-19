import { NextResponse } from 'next/server';
import { authenticateRequest, getProfileForUser } from '@/lib/server-supabase';
import { provisionUser } from '@/lib/auth-provisioning';

/**
 * Idempotent profile provisioning for a signed-in user.
 *
 * The auth context calls this when it has a user but no `profiles` row. Two cases reach it:
 *  - A Google user whose callback provisioning lost the race with the client's first
 *    `getSession` (the row is written, but the client read before it landed).
 *  - A legacy account created by the old client-side flow, whose `profiles` insert RLS
 *    rejected so the row never existed.
 *
 * `provisionUser` is safe to call when a row already exists — it returns it unchanged.
 */
export async function POST(request: Request) {
  const user = await authenticateRequest(request);

  if (!user) {
    return NextResponse.json({ error: 'Sign in to continue.', code: 'unauthenticated' }, { status: 401 });
  }

  // Return the existing row without writing when one is present.
  const existing = await getProfileForUser(user.id);
  if (existing) {
    return NextResponse.json({ profile: existing, created: false });
  }

  try {
    const result = await provisionUser(user);
    return NextResponse.json({ profile: result.profile, created: result.created });
  } catch (error) {
    console.error('Profile provisioning failed:', error);
    return NextResponse.json(
      { error: 'We could not set up your profile. Please try again.', code: 'provisioning_failed' },
      { status: 500 },
    );
  }
}
