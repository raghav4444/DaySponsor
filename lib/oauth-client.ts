'use client';

import { supabase } from '@/lib/supabase';

/**
 * Client-side Google sign-in.
 *
 * Uses the PKCE flow and sends the user to `/auth/callback`, where the code is exchanged
 * for a session and written to cookies. `skipBrowserRedirect` is false on purpose: the
 * browser has to leave the page for the OAuth consent screen.
 */

export const GOOGLE_OAUTH_REDIRECT_PATH = '/auth/callback';

/** The absolute redirect URL Supabase must be configured to allow. */
export function googleRedirectUrl(): string {
  if (typeof window === 'undefined') return GOOGLE_OAUTH_REDIRECT_PATH;
  return `${window.location.origin}${GOOGLE_OAUTH_REDIRECT_PATH}`;
}

export async function signInWithGoogle(returnPath?: string): Promise<{ error: string | null }> {
  const redirectTo = googleRedirectUrl();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: returnPath ? { state: returnPath } : undefined,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // The browser navigates away; nothing returns here on success.
  return { error: null };
}
