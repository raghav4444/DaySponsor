'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'creator' | 'brand'>('creator');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, username, role },
      },
    });

    if (error) {
      toast({
        title: 'Sign up failed',
        description: error.message,
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: data.user.id,
        email,
        name,
        username: username || null,
        role,
      });

      if (profileError) {
        toast({
          title: 'Profile creation issue',
          description: 'Your account was created but we could not set up your profile. Please try signing in.',
          variant: 'destructive',
        });
      } else if (role === 'creator') {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', data.user.id)
          .maybeSingle();

        if (profileData) {
          await supabase.from('creator_profiles').insert({
            profile_id: profileData.id,
          });
        }
      }

      toast({
        title: 'Welcome to DaySponsor!',
        description: 'Your account is ready. Let\'s get you set up.',
      });
      router.push(role === 'brand' ? '/dashboard/brand' : '/dashboard/creator');
    }
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
          <Button type="submit" className="w-full rounded-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
            {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </form>

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
