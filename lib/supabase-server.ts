/**
 * Server-side Supabase client using the SERVICE ROLE key.
 * NEVER import this in client components or expose to the browser.
 * Use only in:
 *   - app/api/** route handlers
 *   - Server Actions ("use server")
 *   - Server Components that need elevated access
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  // In production this must be set; during build it may be absent
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
    );
  }
}

/**
 * Admin client — bypasses RLS.
 * Use only for server-side operations that require elevated privileges.
 */
export function createAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role not configured.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Verify the caller's JWT and return their profile.
 * Returns null if the token is invalid or the profile doesn't exist.
 */
export async function getServerProfile(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  const admin = createAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  return profile as import('./supabase').Profile | null;
}

/**
 * Extract and verify the session from a Next.js Request.
 * Reads the Authorization header.
 */
export async function getProfileFromRequest(req: Request) {
  const authHeader = req.headers.get('authorization');
  return getServerProfile(authHeader);
}
