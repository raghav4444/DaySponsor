import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase admin client.
 *
 * Uses the service role key, so it bypasses RLS. It must NEVER be imported from a
 * browser component: it is backed by `server-only` (throws at build time if bundled
 * client-side) and the service role key is only ever read on the server.
 */

/** Throws a clear error at usage time if the service role key is unset. */
export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Set it in the server environment before calling this function.',
    );
  }
  return key;
}

let adminClient: SupabaseClient | null = null;
let authClient: SupabaseClient | null = null;

/** Lazily created singleton. Callers that need fresh RLS state should prefer
 *  passing their own URL; this identity is safe for service-role writes. */
export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.');
  }
  adminClient = createClient(url, requireServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return adminClient;
}

function getAuthClient(): SupabaseClient {
  if (authClient) return authClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase public environment variables are not set.');
  }
  authClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return authClient;
}

/**
 * Resolves the authenticated user's Supabase session server-side from the
 * `Authorization` header. Token verification uses the public client; the service-role
 * client remains reserved for trusted profile and Stripe data access.
 *
 * Used by every protected Stripe route. Returns null for a missing/invalid token.
 */
export async function authenticateRequest(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    const { data, error } = await getAuthClient().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

/**
 * Loads the `profiles` row for a user id using the service-role client.
 * Returns null if the user has no profile (e.g. a freshly signed-up token).
 */
export async function getProfileForUser(userId: string) {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * A table handle loose enough to chain filters on, for tables the generated database
 * types do not yet describe.
 *
 * Engineer A's auction migration is still pending (see `docs/auction-implementation-contract.md`),
 * so `.from('sponsorship_slots')` resolves to a builder that no longer matches the real
 * columns and TypeScript rejects `.eq(...)` on it. This returns a structurally-typed
 * builder instead; every call site still asserts the resolved row shape it expects, and
 * no client-side code can reach it (this module is `server-only`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adminFrom(table: string): any {
  return getAdminClient().from(table);
}

/**
 * Loads the `creator_profiles` row for a given profile row id (service role).
 * Use this on the server to confirm a creator owns a profile before acting.
 */
export async function getCreatorProfileForProfileId(profileId: string) {
  const { data, error } = await getAdminClient()
    .from('creator_profiles')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * Loads the full user profile (profiles + creator_profiles) for a user token.
 */
export async function getProfileWithCreator(userId: string) {
  const profile = await getProfileForUser(userId);
  if (!profile) return { profile: null, creatorProfile: null };
  const creatorProfile = await getCreatorProfileForProfileId(profile.id);
  return { profile, creatorProfile };
}