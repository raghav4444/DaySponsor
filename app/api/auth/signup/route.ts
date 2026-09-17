import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { provisionUser } from '@/lib/auth-provisioning';
import { isSupabaseServerConfigured, requireSupabaseServerConfig } from '@/lib/supabase-server';

/**
 * Server-side signup.
 *
 * The old flow called `supabase.auth.signUp()` in the browser and then inserted the
 * `profiles` row with the same client. When email confirmation is on, `signUp()` returns
 * no session, so that insert ran unauthenticated and RLS rejected it — the account
 * existed but had no profile, and every dashboard behind it was broken.
 *
 * Signing up here means the profile is provisioned from the verified user record with the
 * service-role client, which has no session of its own to be missing. The browser then
 * signs in with the returned session (or is told to confirm its email first).
 */

const SignupSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  username: z
    .string()
    .trim()
    .max(40, 'Username must be 40 characters or fewer.')
    .toLowerCase()
    .transform((value) => value.replace(/\s/g, ''))
    .optional()
    .or(z.literal('')),
  role: z.enum(['creator', 'brand']).default('creator'),
});

type SignupInput = {
  email: string;
  password: string;
  name: string;
  username?: string;
  role: 'creator' | 'brand';
};

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json(
      { error: 'Sign up is unavailable. Supabase is not configured.', code: 'unconfigured' },
      { status: 503 },
    );
  }

  let parsed: SignupInput;
  try {
    const body = await request.json();
    parsed = SignupSchema.parse(body) as SignupInput;
  } catch {
    return NextResponse.json(
      { error: 'Please check your details and try again.', code: 'invalid_input' },
      { status: 400 },
    );
  }

  const { url, anonKey } = requireSupabaseServerConfig();

  // Sign up with the anon key, never the service role: the user must be created through
  // the public auth surface so the project's signup and confirmation settings apply.
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.signUp({
    email: parsed.email,
    password: parsed.password,
    options: {
      data: { name: parsed.name, username: parsed.username || null, role: parsed.role },
    },
  });

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code ?? 'signup_failed' },
      { status: 400 },
    );
  }

  const user = data.user;
  if (!user) {
    return NextResponse.json(
      { error: 'Sign up failed. Please try again.', code: 'no_user' },
      { status: 400 },
    );
  }

  // Provision the profile regardless of confirmation state, so it exists by the time the
  // user finishes confirming and signs in.
  try {
    await provisionUser(user, {
      role: parsed.role,
      name: parsed.name,
      username: parsed.username || null,
    });
  } catch (provisioningError) {
    console.error('Signup profile provisioning failed:', provisioningError);
    return NextResponse.json(
      {
        error:
          'Your account was created but your profile could not be set up. Please sign in to retry.',
        code: 'provisioning_failed',
      },
      { status: 500 },
    );
  }

  // When email confirmation is off (or the provider already verified the address) GoTrue
  // returns a session the browser can use immediately. Otherwise the user must confirm
  // first, and the client shows a "check your email" state instead of pretending to be
  // signed in.
  const requiresEmailConfirmation = !data.session;
  if (requiresEmailConfirmation) {
    return NextResponse.json({
      ok: true,
      requiresEmailConfirmation: true,
      session: null,
    });
  }

  return NextResponse.json({
    ok: true,
    requiresEmailConfirmation: false,
    session: {
      access_token: data.session!.access_token,
      refresh_token: data.session!.refresh_token,
      expires_in: data.session!.expires_in,
    },
  });
}
