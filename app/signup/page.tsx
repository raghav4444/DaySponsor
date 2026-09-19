'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ArrowRight, Check, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { signInWithGoogle } from '@/lib/oauth-client';

/**
 * Signup page.
 *
 * Account creation happens through `POST /api/auth/signup` rather than calling
 * `supabase.auth.signUp()` in the browser. The old flow inserted the `profiles` row from
 * the client right after signup, which RLS rejected whenever `signUp()` returned no
 * session (the case whenever email confirmation is on), leaving the user with an account
 * and no profile. The route provisions the profile server-side and hands back a session
 * when one was issued, which the browser then sets here.
 */
export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'creator' | 'brand'>('creator');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [confirmationCountdown, setConfirmationCountdown] = useState<number | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (confirmationCountdown === null || confirmationCountdown <= 0) return;

    const timer = window.setTimeout(() => {
      setConfirmationCountdown((current) => (current === null ? null : current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [confirmationCountdown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, username, role }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        requiresEmailConfirmation?: boolean;
        session?: {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        } | null;
      };

      if (!response.ok || !result.ok) {
        toast({
          title: 'Sign up failed',
          description: result.error ?? 'Something went wrong. Please try again.',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      // The account exists and the profile is provisioned. If the project requires email
      // confirmation there is no session yet, so say so instead of routing to a
      // dashboard the user cannot reach.
      if (result.requiresEmailConfirmation || !result.session) {
        setLoading(false);
        setConfirmationCountdown(10);
        return;
      }

      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });

      if (setSessionError) {
        // The account is created and provisioned; a client-side session failure just
        // means the user signs in normally.
        toast({
          title: 'Account created',
          description: 'Your account is ready. Please sign in.',
        });
        setLoading(false);
        router.push('/login');
        return;
      }

      toast({
        title: 'Welcome to DaySponsor!',
        description: 'Your account is ready. Let\'s get you set up.',
      });

      // The auth context picks the session up via onAuthStateChange; the profile it
      // loads decides which dashboard to show.
      router.push(role === 'brand' ? '/dashboard/brand' : '/dashboard/creator');
    } catch {
      toast({
        title: 'Sign up failed',
        description: 'We could not reach the server. Please try again.',
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      toast({
        title: 'Google sign up failed',
        description: error,
        variant: 'destructive',
      });
      setGoogleLoading(false);
    }
    // On success the browser leaves the page for Google's consent screen.
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-24">
      {confirmationCountdown !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirmation-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Mail className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              One last step
            </p>
            <h2 id="confirmation-title" className="text-2xl font-semibold tracking-tight">
              Check your email
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>.
              Verify your email first, then sign in to your DaySponsor account.
            </p>
            <div className="mt-6 rounded-xl bg-secondary p-4 text-center">
              <p className="text-sm text-muted-foreground">
                {confirmationCountdown > 0
                  ? `You can continue to login in ${confirmationCountdown}s`
                  : 'Your account is ready for login.'}
              </p>
            </div>
            <Button
              type="button"
              className="mt-6 w-full rounded-full"
              disabled={confirmationCountdown > 0}
              onClick={() => router.push('/login?confirmed=awaiting')}
            >
              Continue to login
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Link href="/" className="flex items-center gap-2 mb-8 group">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background transition-transform group-hover:scale-105">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="text-xl font-semibold tracking-tight">DaySponsor</span>
      </Link>

      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Create your account</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Join the marketplace where brands sponsor real experiences
        </p>

        <div className="mb-6">
          <Label className="block mb-2">I am a...</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole('creator')}
              className={`rounded-xl border p-4 text-left transition-all ${
                role === 'creator'
                  ? 'border-foreground bg-secondary'
                  : 'border-border hover:border-foreground/30'
              }`}
            >
              <p className="font-semibold text-sm">Creator</p>
              <p className="text-xs text-muted-foreground mt-1">Get paid to use products</p>
              {role === 'creator' && <Check className="h-4 w-4 mt-2 text-accent" />}
            </button>
            <button
              type="button"
              onClick={() => setRole('brand')}
              className={`rounded-xl border p-4 text-left transition-all ${
                role === 'brand'
                  ? 'border-foreground bg-secondary'
                  : 'border-border hover:border-foreground/30'
              }`}
            >
              <p className="font-semibold text-sm">Brand</p>
              <p className="text-xs text-muted-foreground mt-1">Sponsor creator days</p>
              {role === 'brand' && <Check className="h-4 w-4 mt-2 text-accent" />}
            </button>
          </div>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              placeholder="janedoe"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
            />
          </div>
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
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full rounded-full"
            disabled={loading || googleLoading}
          >
            {loading ? 'Creating account...' : 'Create account'}
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
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
