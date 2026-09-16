'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Slot, type Day, type Profile } from '@/lib/supabase';

type CheckoutData = Slot & {
  days: Day & { profiles: Profile };
};

/**
 * Slot checkout entry point.
 *
 * This page used to fake payment: it inserted a `sponsorships` row from the browser,
 * flipped `is_available` off, and toasted "Payment via Stripe will be connected when
 * configured." That created an unpaid, unusable sponsorship with no charge behind it.
 *
 * Sponsorships are now created server-side by `POST /api/stripe/checkout/winning-bid`,
 * which mints a real Checkout Session for a slot that has a winning bid. This page just
 * resolves the slot and hands off: a slot which is not awaiting payment from this brand
 * is redirected to the day page, where the auction panel is the single way to bid.
 */
export default function CheckoutPage() {
  const { id } = useParams();
  const router = useRouter();
  const { loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    void loadSlot(id as string);
  }, [id]);

  const loadSlot = async (slotId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sponsorship_slots')
      .select(`
        id, day_id, tier, position, description,
        days!inner(
          id, title, day_date, location, category, expected_reach, creator_id,
          profiles!days_creator_id_fkey(name, username)
        )
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (error || !data) {
      setLoading(false);
      return;
    }

    const row = data as unknown as CheckoutData;
    if (row.days?.id) {
      // The day page holds the auction panel and the current slot state; a stale link to
      // a slot that no longer awaits this brand's payment lands there rather than erroring.
      router.replace(`/days/${row.days.id}`);
      return;
    }

    setLoading(false);
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Redirecting to the day…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
      <p className="text-lg font-medium text-muted-foreground">Slot not found</p>
      <Link href="/explore">
        <Button variant="outline">Back to explore</Button>
      </Link>
    </div>
  );
}
