'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, Lock, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { supabase, type Slot, type Day, type Profile } from '@/lib/supabase';

type CheckoutData = Slot & {
  days: Day & { profiles: Profile };
};

export default function CheckoutPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [slot, setSlot] = useState<CheckoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (id) loadSlot(id as string);
  }, [id]);

  const loadSlot = async (slotId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sponsorship_slots')
      .select(`
        *,
        days!inner(
          id, title, day_date, location, category, expected_reach,
          profiles!days_creator_id_fkey(name, username)
        )
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (error || !data) {
      setLoading(false);
      return;
    }

    setSlot(data as unknown as CheckoutData);
    setLoading(false);
  };

  const handleCheckout = async () => {
    if (!user || !profile) {
      toast({ title: 'Please sign in', description: 'You need an account to sponsor a day.' });
      router.push('/login');
      return;
    }

    if (profile.role !== 'brand') {
      toast({ title: 'Brand account required', description: 'Only brand accounts can sponsor days.', variant: 'destructive' });
      return;
    }

    if (!slot || !slot.is_available) {
      toast({ title: 'Slot unavailable', variant: 'destructive' });
      return;
    }

    setProcessing(true);

    const platformFee = Math.round(slot.price * 0.1);
    const creatorAmount = slot.price - platformFee;

    const { data: sponsorship, error: sponsorError } = await supabase
      .from('sponsorships')
      .insert({
        slot_id: slot.id,
        brand_id: profile.id,
        creator_id: slot.days.creator_id,
        amount: slot.price,
        platform_fee: platformFee,
        creator_amount: creatorAmount,
        status: 'pending',
      })
      .select()
      .single();

    if (sponsorError || !sponsorship) {
      toast({ title: 'Failed to create sponsorship', description: sponsorError?.message, variant: 'destructive' });
      setProcessing(false);
      return;
    }

    const { error: slotError } = await supabase
      .from('sponsorship_slots')
      .update({ is_available: false })
      .eq('id', slot.id);

    if (slotError) {
      console.error('Failed to update slot:', slotError);
    }

    toast({
      title: 'Sponsorship created!',
      description: `Your sponsorship of €${slot.price} has been recorded. Payment via Stripe will be connected when configured.`,
    });

    router.push(`/checkout/success?id=${sponsorship.id}`);
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading checkout...</p>
      </div>
    );
  }

  if (!slot) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Slot not found</p>
        <Link href="/explore"><Button variant="outline">Back to explore</Button></Link>
      </div>
    );
  }

  const dateStr = new Date(slot.days.day_date).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const platformFee = Math.round(slot.price * 0.1);
  const creatorAmount = slot.price - platformFee;

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-12">
        <Link href={`/days/${slot.days.id}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to day
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">Checkout</h1>
        <p className="text-muted-foreground mb-8">Review your sponsorship details and confirm</p>

        <div className="rounded-2xl border border-border bg-card overflow-hidden mb-6">
          <div className="p-6 border-b border-border">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {slot.tier} Sponsor · 🥇
                </p>
                <h2 className="font-semibold text-xl">{slot.days.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  by @{slot.days.profiles.username || slot.days.profiles.name} · {dateStr}
                </p>
                <p className="text-sm text-muted-foreground">{slot.days.location}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold">€{slot.price}</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sponsorship amount</span>
              <span className="font-medium">€{slot.price}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Platform fee (10%)</span>
              <span className="font-medium">€{platformFee}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Creator receives</span>
              <span className="font-medium text-accent">€{creatorAmount}</span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <span className="font-semibold">Total</span>
              <span className="font-bold text-xl">€{slot.price}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-secondary/30 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold">Payment method</h3>
          </div>
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center">
            <Lock className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">Stripe payment integration</p>
            <p className="text-xs text-muted-foreground mt-1">
              Secure payment processing will be activated once Stripe is configured.
              Your sponsorship will be recorded and payment can be completed later.
            </p>
          </div>
        </div>

        <Button
          onClick={handleCheckout}
          size="lg"
          className="w-full rounded-full"
          disabled={processing}
        >
          {processing ? 'Processing...' : `Confirm sponsorship · €${slot.price}`}
        </Button>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Sponsored placement does not guarantee a positive review</span>
        </div>
      </div>
    </div>
  );
}
