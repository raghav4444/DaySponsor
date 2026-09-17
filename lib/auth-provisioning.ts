import type { User } from '@supabase/supabase-js';
import { getAdminClient } from '@/lib/server-supabase';

/**
 * Profile provisioning. Server-only: uses the service-role client and bypasses RLS.
 *
 * Signup used to insert into `profiles` from the browser immediately after
 * `supabase.auth.signUp()`. Two things broke that:
 *
 *  1. With email confirmation enabled, `signUp()` returns a user but no session, so the
 *     insert ran as an anonymous client and RLS (`profiles_insert_own` requires
 *     `auth.uid() = user_id`) rejected it. The user was told their account was ready
 *     while no profile row existed.
 *  2. OAuth sign-in has no signup form at all — there is nowhere to collect a name or a
 *     role before the user lands in the app.
 *
 * Provisioning therefore happens here, server-side, with the service-role client that
 * bypasses RLS. It is idempotent, so it is safe to run on every signup and every login:
 * a retried signup or a returning Google user must never duplicate a row or error out.
 *
 * The client never writes `profiles` or `creator_profiles` directly again.
 */

export type ProvisionableRole = 'creator' | 'brand';

export type ProvisioningHints = {
  role?: ProvisionableRole;
  name?: string | null;
  username?: string | null;
};

export type ProvisioningResult = {
  profile: Record<string, unknown>;
  created: boolean;
};

/** Reads the name an OAuth or email signup supplied, falling back to the email handle. */
function resolveName(user: User, hints: ProvisioningHints): string {
  const fromHint = hints.name?.trim();
  if (fromHint) return fromHint;

  const metadataName =
    (user.user_metadata?.name as string | undefined)?.trim() ||
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.user_metadata?.user_name as string | undefined)?.trim();
  if (metadataName) return metadataName;

  // Google users always have an email; the local part is a better placeholder than blank.
  const email = user.email ?? 'user';
  return email.split('@')[0];
}

/** Derives a username, or null so the column keeps its unique constraint satisfiable. */
function resolveUsername(user: User, hints: ProvisioningHints): string | null {
  const fromHint = hints.username?.trim().toLowerCase().replace(/\s/g, '');
  if (fromHint) return fromHint;

  const metadataUsername = (user.user_metadata?.user_name as string | undefined)
    ?.trim()
    .toLowerCase();
  if (metadataUsername) return metadataUsername;

  // Prefer no username over a generated one that could collide.
  return null;
}

/**
 * Ensures a `profiles` row exists for `user`, creating it if needed.
 *
 * An existing row is never overwritten: a user who signed up as a brand must not be
 * downgraded to creator by a stale `role` in their metadata on a later login. The role
 * and name are only consulted on first creation.
 */
export async function ensureProfileForUser(
  user: User,
  hints: ProvisioningHints = {},
): Promise<ProvisioningResult> {
  const client = getAdminClient();

  const { data: existing, error: lookupError } = await client
    .from('profiles')
    .select('id, role, user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Could not look up a profile: ${lookupError.message}`);
  }

  if (existing) {
    return { profile: existing, created: false };
  }

  const role = hints.role ?? 'creator';

  const row = {
    user_id: user.id,
    email: user.email ?? '',
    name: resolveName(user, hints),
    username: resolveUsername(user, hints),
    role,
  };

  const { data: inserted, error: insertError } = await client
    .from('profiles')
    .insert(row)
    .select('id, role, user_id')
    .single();

  if (insertError || !inserted) {
    // A concurrent provision (e.g. the OAuth callback racing a webhook) can win the
    // insert between our lookup and here. Re-read rather than surfacing a duplicate-key
    // error to the user, since the desired end state has already been reached.
    if (insertError?.code === '23505') {
      const { data: retry, error: retryError } = await client
        .from('profiles')
        .select('id, role, user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (retryError || !retry) {
        throw new Error(
          `Profile exists but could not be re-read: ${retryError?.message ?? 'unknown'}`,
        );
      }
      return { profile: retry, created: false };
    }
    throw new Error(`Could not create a profile: ${insertError?.message ?? 'unknown'}`);
  }

  return { profile: inserted, created: true };
}

/**
 * Ensures the `creator_profiles` row exists for a creator profile. Idempotent: a second
 * login leaves the existing row untouched, so accumulated earnings and Stripe state are
 * never reset.
 */
export async function ensureCreatorProfileForProfileId(profileId: string): Promise<void> {
  const client = getAdminClient();

  const { data: existing, error: lookupError } = await client
    .from('creator_profiles')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Could not look up a creator profile: ${lookupError.message}`);
  }

  if (existing) return;

  const { error: insertError } = await client
    .from('creator_profiles')
    .insert({ profile_id: profileId })
    .select('id')
    .single();

  // 23505 is the duplicate-key error a racing provision leaves behind; the row exists, so
  // the caller's goal is met and there is nothing more to do.
  if (insertError && insertError.code !== '23505') {
    throw new Error(`Could not create a creator profile: ${insertError.message}`);
  }
}

/**
 * Provisions everything a user needs to use the app: the `profiles` row, and the
 * `creator_profiles` row when the role calls for one.
 */
export async function provisionUser(
  user: User,
  hints: ProvisioningHints = {},
): Promise<ProvisioningResult> {
  const result = await ensureProfileForUser(user, hints);

  // Only create the creator row on first creation; an existing brand must not gain one.
  if (result.created && result.profile.role !== 'brand') {
    await ensureCreatorProfileForProfileId(result.profile.id as string);
  }

  return result;
}
