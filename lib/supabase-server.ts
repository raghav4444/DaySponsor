import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Server-side Supabase clients backed by cookies.
 *
 * The app previously authenticated only via an `Authorization: Bearer` header that the
 * browser attached to API calls. That cannot carry an OAuth login: the Google redirect
 * returns to the app as a full page navigation, so there is no in-page fetch to attach a
 * header to. Cookies are the only thing that survive that redirect, and `@supabase/ssr`
 * is what keeps them in sync with the client's session.
 *
 * Routes that already use the `Authorization` header (`app/api/dashboard/**`,
 * `app/api/stripe/**`) keep working unchanged: nothing here alters them.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when the public env vars are present. Auth routes refuse to run otherwise. */
export function isSupabaseServerConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function requireSupabaseServerConfig(): { url: string; anonKey: string } {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

/**
 * A Route Handler client. Reads and writes the auth cookies on the incoming request, so
 * a callback route can exchange an OAuth code for a session in the same request that
 * served the redirect.
 */
export async function createRouteHandlerClient() {
  const { url, anonKey } = requireSupabaseServerConfig();
  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // The `cookies()` API throws when called from a context that cannot set them
          // (a Server Component render). Route handlers can set them, so reaching here
          // means the caller is in the wrong context — the read path still works.
        }
      },
    },
  });
}
