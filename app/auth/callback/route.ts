import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase-server';
import { provisionUser } from '@/lib/auth-provisioning';

/**
 * OAuth callback.
 *
 * Google (and any other OAuth provider) redirects here after consent. The PKCE code is
 * exchanged for a session and written to cookies, then the user is sent to the dashboard
 * that matches their role.
 *
 * Profile provisioning runs here rather than in the browser because an OAuth user has no
 * signup form: their name and email come from the provider, and the role defaults to
 * creator. `provisionUser` is idempotent, so returning users pass straight through.
 */

const DASHBOARD_BY_ROLE: Record<string, string> = {
  brand: '/dashboard/brand',
  admin: '/dashboard/admin',
};

function dashboardForRole(role: string | null | undefined): string {
  return DASHBOARD_BY_ROLE[role ?? ''] ?? '/dashboard/creator';
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');

  // Google reports a provider problem (e.g. the project's Google app is not configured
  // yet) as an error parameter rather than a thrown error. Surface it on the login page.
  if (error) {
    const loginUrl = new URL('/login', requestUrl.origin);
    loginUrl.searchParams.set('oauth_error', error);
    if (errorDescription) loginUrl.searchParams.set('oauth_error_description', errorDescription);
    return NextResponse.redirect(loginUrl);
  }

  if (!code) {
    const loginUrl = new URL('/login', requestUrl.origin);
    loginUrl.searchParams.set('oauth_error', 'missing_code');
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createRouteHandlerClient();

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !data.session?.user) {
    const loginUrl = new URL('/login', requestUrl.origin);
    loginUrl.searchParams.set('oauth_error', 'exchange_failed');
    if (exchangeError?.message) {
      loginUrl.searchParams.set('oauth_error_description', exchangeError.message);
    }
    return NextResponse.redirect(loginUrl);
  }

  // The provider has confirmed the user's email, so an OAuth sign-in is treated as
  // verified regardless of the project's email-confirmation setting.
  try {
    const result = await provisionUser(data.session.user);
    const destination = new URL(dashboardForRole(result.profile.role as string), requestUrl.origin);
    return NextResponse.redirect(destination);
  } catch (provisioningError) {
    // The user is signed in, so do not dump them at a login screen: send them to their
    // dashboard and let the auth context repair the missing profile on the client.
    console.error('OAuth profile provisioning failed:', provisioningError);
    const destination = new URL('/dashboard/creator', requestUrl.origin);
    destination.searchParams.set('profile_error', 'provisioning_failed');
    return NextResponse.redirect(destination);
  }
}
