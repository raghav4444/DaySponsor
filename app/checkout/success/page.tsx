'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sponsorshipId = searchParams.get('id');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!sponsorshipId) {
      router.push('/explore');
      return;
    }
    setLoaded(true);
  }, [sponsorshipId, router]);

  if (!loaded) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-24">
      <div className="max-w-md text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 mx-auto mb-6 animate-fade-in">
          <CheckCircle2 className="h-8 w-8 text-accent" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-3">Sponsorship confirmed!</h1>
        <p className="text-muted-foreground mb-8">
          Your sponsorship has been recorded. The creator has been notified and will
          start using your product on their day. You&apos;ll receive updates as the
          campaign progresses.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild className="rounded-full">
            <Link href="/dashboard/brand">
              View campaign
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" className="rounded-full" asChild>
            <Link href="/explore">Explore more days</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
