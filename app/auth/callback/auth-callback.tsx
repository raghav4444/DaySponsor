'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Exchanges the OAuth code for a session in the browser.
 *
 * The PKCE flow stores its code verifier in this browser's storage when `signInWithGoogle`
 * runs, so the exchange has to happen here too. A server route cannot read that verifier —
 * the GoTrue error for that case reads "PKCE code verifier not found in storage ... use
 * @supabase/ssr on both the server and client to store the code verifier in cookies".
 *
 * Keeping the exchange client-side also keeps the session in one place: the browser client
 * that started the flow ends up holding it, so no second hop is needed to make the rest of
 * the app see the same session.
 *
 * Profile provisioning is deliberately *not* done here. It happens on the server with the
 * service-role client (see `lib/auth-provisioning.ts`), which can write `profiles` without
 * a session; an OAuth user has no signup form to collect their name from, so the server
 * derives it from the provider's metadata instead.
 */

const DASHBOARD_BY_ROLE: Record<string, string> = {
  brand: '/dashboard/brand',
  admin: '/dashboard/admin',
};

function dashboardForRole(role: string | null | undefined): string {
  return DASHBOARD_BY_ROLE[role ?? ''] ?? '/dashboard/creator';
}

export function AuthCallback() {
  const router = useRouter();
  const [message, setMessage] = useState('Signing you in…');

  useEffect(() => {
    const url = new URL(window.location.href);
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    const code = url.searchParams.get('code');

    // Google reports a provider problem (the project's Google app is not configured yet)
    // as an error parameter rather than a thrown error. Send it to the login page, which
    // explains it instead of showing a blank screen.
    if (error || !code) {
      const loginUrl = new URL('/login', url.origin);
      loginUrl.searchParams.set('oauth_error', error ?? 'missing_code');
      if (errorDescription) loginUrl.searchParams.set('oauth_error_description', errorDescription);
      router.replace(loginUrl.toString());
      return;
    }

    setMessage('Completing your sign in…');

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error: exchangeError, data }) => {
        if (exchangeError || !data.session) {
          const loginUrl = new URL('/login', url.origin);
          loginUrl.searchParams.set('oauth_error', 'exchange_failed');
          if (exchangeError?.message) {
            loginUrl.searchParams.set('oauth_error_description', exchangeError.message);
          }
          router.replace(loginUrl.toString());
          return;
        }

        // Tell the server to provision the profile for this new user, then route by the
        // role it reports. A returning user passes straight through the same idempotent
        // call, so this is safe on every login.
        const token = data.session.access_token;
        setMessage('Setting up your profile…');

        fetch('/api/auth/provision', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        })
          .then((r) => r.json())
          .then((body: { profile?: { role?: string | null } }) => {
            router.replace(dashboardForRole(body.profile?.role));
          })
          .catch(() => {
            // The user is signed in; do not dump them at a login screen. The auth context
            // retries provisioning from the dashboard, so send them on their way.
            router.replace('/dashboard/creator');
          });
      })
      .catch(() => {
        const loginUrl = new URL('/login', url.origin);
        loginUrl.searchParams.set('oauth_error', 'exchange_failed');
        router.replace(loginUrl.toString());
      });
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
