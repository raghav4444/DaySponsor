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

/**
 * Unwraps a PostgREST response into a single row.
 *
 * supabase-js returns an *array* from `.insert().select().single()` even though
 * `.single()` is meant to promise one row — the array is always present, and treating it
 * as the row itself silently yields `undefined` for every column. Both the array and the
 * bare-row shapes are normalised here so callers can read `profile.id` either way.
 */
function asRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return data[0] ?? null;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

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

  // Same columns as the insert below: an existing row must carry the primary key too, so
  // that the caller links the creator_profiles row to the right profile whichever path
  // produced it.
  const { data: existing, error: lookupError } = await client
    .from('profiles')
    .select('id, role, user_id, email, name, username')
    .eq('user_id', user.id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Could not look up a profile: ${lookupError.message ?? JSON.stringify(lookupError)}`,
    );
  }

  const existingRow = asRow(existing);
  if (existingRow) {
    return { profile: existingRow, created: false };
  }

  const role = hints.role ?? 'creator';

  const row = {
    user_id: user.id,
    email: user.email ?? '',
    name: resolveName(user, hints),
    username: resolveUsername(user, hints),
    role,
  };

  // Select every column the caller needs. PostgREST only returns the columns named in
  // `select()`; asking for the primary key here is what lets the creator_profiles row
  // below reference it. The generated `id` is otherwise invisible to the caller.
  const { data: inserted, error: insertError } = await client
    .from('profiles')
    .insert(row)
    .select('id, role, user_id, email, name, username')
    .single();

  if (insertError || !inserted) {
    // A concurrent provision (e.g. the OAuth callback racing a webhook) can win the
    // insert between our lookup and here. Re-read rather than surfacing a duplicate-key
    // error to the user, since the desired end state has already been reached.
    if (insertError?.code === '23505') {
      const { data: retry, error: retryError } = await client
        .from('profiles')
        .select('id, role, user_id, email, name, username')
        .eq('user_id', user.id)
        .maybeSingle();
      const retryRow = asRow(retry);
      if (retryError || !retryRow) {
        throw new Error(
          `Profile exists but could not be re-read: ${retryError?.message ?? 'unknown'}`,
        );
      }
      return { profile: retryRow, created: false };
    }
    throw new Error(`Could not create a profile: ${insertError?.message ?? 'unknown'}`);
  }

  const insertedRow = asRow(inserted);
  if (!insertedRow) {
    throw new Error('Could not create a profile: the insert returned no row.');
  }
  return { profile: insertedRow, created: true };
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
    throw new Error(
      `Could not look up a creator profile: ${lookupError.message ?? JSON.stringify(lookupError)}`,
    );
  }

  if (asRow(existing)) return;

  const { error: insertError } = await client
    .from('creator_profiles')
    .insert({ profile_id: profileId })
    .select('id')
    .single();

  // 23505 is the duplicate-key error a racing provision leaves behind; the row exists, so
  // the caller's goal is met and there is nothing more to do.
  if (insertError && insertError.code !== '23505') {
    throw new Error(
      `Could not create a creator profile: ${insertError.message ?? JSON.stringify(insertError)}`,
    );
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
