'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { isLocalAdminCredentials, localAdminSessionKey } from '@/lib/local-admin';
import { signInWithGoogle } from '@/lib/oauth-client';

/**
 * Login page.
 *
 * After a successful password sign-in the user is routed from their server-resolved
 * profile role, not a hardcoded path: the old code sent every user to
 * `/dashboard/creator`, so brands landed on the creator dashboard.
 */

type SessionResponse = {
  user?: { id: string; email: string | null } | null;
  profile?: {
    role?: string | null;
  } | null;
};

function dashboardForRole(role: string | null | undefined): string {
  switch (role) {
    case 'brand':
      return '/dashboard/brand';
    case 'admin':
      return '/dashboard/admin';
    default:
      return '/dashboard/creator';
  }
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Google reports a provider failure here when its consent screen redirects back.
  const oauthError = searchParams.get('oauth_error');
  const oauthErrorDescription = searchParams.get('oauth_error_description');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isLocalAdminCredentials(email, password)) {
      window.localStorage.setItem(localAdminSessionKey, 'true');
      window.dispatchEvent(new Event('local-admin-auth'));
      toast({ title: 'Welcome back!', description: 'You are signed in as the local test admin.' });
      router.push('/dashboard/admin');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // "Email not confirmed" is the most common cause and deserves an actionable
      // message rather than the raw GoTrue string.
      const description =
        error.code === 'email_not_confirmed'
          ? 'Confirm your email before signing in, or sign up again to resend the link.'
          : error.message;

      toast({
        title: 'Sign in failed',
        description,
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    // Route from the profile's real role so a brand reaches the brand dashboard.
    let destination = '/dashboard/creator';
    if (data.user) {
      try {
        const response = await fetch('/api/auth/session', {
          headers: data.session
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : undefined,
        });
        if (response.ok) {
          const session = (await response.json()) as SessionResponse;
          destination = dashboardForRole(session.profile?.role);
        }
      } catch {
        // A profile lookup failure must not block a valid sign-in; the default route
        // still works and the dashboard will prompt for sign-in if something is wrong.
      }
    }

    toast({ title: 'Welcome back!', description: 'You are now signed in.' });
    setLoading(false);
    router.push(destination);
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      toast({
        title: 'Google sign in failed',
        description: error,
        variant: 'destructive',
      });
      setGoogleLoading(false);
    }
    // On success the browser leaves the page for Google's consent screen.
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-24">
      <Link href="/" className="flex items-center gap-2 mb-8 group">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background transition-transform group-hover:scale-105">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="text-xl font-semibold tracking-tight">DaySponsor</span>
      </Link>

      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Welcome back</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sign in to your DaySponsor account
        </p>

        {oauthError && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            <p className="font-medium text-destructive">Google sign in failed</p>
            <p className="mt-1 text-muted-foreground">
              {oauthErrorDescription ??
                'We could not complete the Google sign in. Please try again.'}
            </p>
            {oauthError === 'provider_disabled' || oauthError === 'invalid_request' ? (
              <p className="mt-2 text-muted-foreground">
                Google may not be enabled for this project yet.
              </p>
            ) : null}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full rounded-full"
            disabled={loading || googleLoading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
            {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-card px-3 text-xs uppercase tracking-wide text-muted-foreground">
              or
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full rounded-full"
          disabled={loading || googleLoading}
          onClick={handleGoogle}
        >
          {googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // `useSearchParams` must be inside a Suspense boundary for the page to build.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
