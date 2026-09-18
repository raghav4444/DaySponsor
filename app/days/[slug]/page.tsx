'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MapPin, Users, Calendar, ArrowLeft, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { supabase, type Day, type Profile, type CreatorProfile } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { AuctionPanel, type BidOutcome } from '@/components/auction/auction-panel';
import {
  loadSlotsForDayWithAuction,
  loadMyBidsForSlots,
  type SlotWithAuction,
} from '@/lib/auction-queries';
import { formatMinorUnits } from '@/lib/money';

/**
 * Day detail page.
 *
 * The design and route are unchanged; the fixed-price sponsorship behaviour is replaced
 * by bidding. Slots are loaded server-side through the auction data layer so the public
 * auction columns (`current_highest_bid`, `bid_count`, `auction_ends_at`) come from one
 * place, and so the caller's own bid — never anyone else's — is attached as `my_bid`.
 *
 * The countdown is visual only: when it reaches zero the client refetches slot state
 * rather than concluding the auction, because the closing job owns that transition.
 */
export default function DayDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [day, setDay] = useState<(Day & { profiles: Profile; creator_profiles: CreatorProfile | null }) | null>(null);
  const [slots, setSlots] = useState<SlotWithAuction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDay = useCallback(async (dayId: string) => {
    setLoading(true);

    const { data: dayData, error: dayError } = await supabase
      .from('days')
      .select(`
        *,
        profiles!days_creator_id_fkey(*),
        creator_profiles!inner(profile_id:profile_id, *)
      `)
      .eq('id', dayId)
      .maybeSingle();

    if (dayError || !dayData) {
      setLoading(false);
      return;
    }

    setDay(dayData as unknown as Day & { profiles: Profile; creator_profiles: CreatorProfile });

    // Auction columns are read through the data layer, which is the single seam that
    // changes when Engineer A's generated types land.
    const auctionSlots = await loadSlotsForDayWithAuction(dayId);
    setSlots(auctionSlots);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (id) loadDay(id as string);
  }, [id, loadDay]);

  // Attach the caller's own bids, if any. Only own rows are fetched, so no other brand's
  // identity can reach the client.
  useEffect(() => {
    if (!profile?.id || slots.length === 0) return;
    loadMyBidsForSlots(
      profile.id,
      slots.map((s) => s.id),
    ).then((bySlot) => {
      setSlots((current) =>
        current.map((slot) => {
          const myBid = bySlot.get(slot.id) ?? null;
          return {
            ...slot,
            my_bid: myBid,
            is_winning: Boolean(myBid && myBid.status === 'winner'),
          };
        }),
      );
    });
  }, [profile?.id, slots.length]);

  const handleElapsed = useCallback(() => {
    // The countdown hit zero: refetch instead of concluding. The server owns close time.
    if (id) loadDay(id as string);
  }, [id, loadDay]);

  const handlePlaceBid = useCallback(
    async (slotId: string, amountMinorUnits: number): Promise<BidOutcome> => {
      if (!user || !profile) {
        toast({ title: 'Please sign in', description: 'You need an account to bid.' });
        router.push('/login');
        return { ok: false };
      }

      if (profile.role !== 'brand') {
        return {
          ok: false,
          message: 'Switch to a brand account to bid.',
        };
      }

      const response = await fetch('/api/auction/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, amount: amountMinorUnits }),
      });

      const payload = (await response.json()) as {
        error?: string;
        code?: string;
        currentHighestBid?: number;
        auctionEndsAt?: string | null;
        status?: string | null;
        bidId?: string | null;
      };

      if (!response.ok) {
        // A conflict carries the live current bid back so the UI can update to it.
        return {
          ok: false,
          currentHighestBid: payload.currentHighestBid,
          message: payload.error,
        };
      }

      return {
        ok: true,
        currentHighestBid: payload.currentHighestBid,
      };
    },
    [user, profile, router, toast],
  );

  if (loading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading day...</div>
      </div>
    );
  }

  if (!day) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Day not found</p>
        <Link href="/explore">
          <Button variant="outline">Back to explore</Button>
        </Link>
      </div>
    );
  }

  const tierIcons: Record<string, string> = { Primary: '🥇', Featured: '🥈', Supporting: '🥉' };
  const tierDescriptions: Record<string, string> = {
    Primary: 'Product used throughout the day · Social mentions on X/Instagram/TikTok · Full review with photos · Profile placement',
    Featured: 'Product usage during the day · Social mention · Review with photo',
    Supporting: 'Product usage · Mention · Short review',
  };

  const dateStr = new Date(day.day_date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const isOwnDay = user?.id === day.profiles?.user_id;
  const openAuctions = slots.filter((s) => s.auction_status === 'open').length;

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to explore
        </Link>

        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8">
          <div>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="relative h-48 bg-gradient-to-br from-secondary to-secondary/50">
                <div
                  className="absolute inset-0 opacity-30"
                  style={{ background: 'linear-gradient(135deg, hsl(var(--accent) / 0.3), transparent)' }}
                />
                <div className="absolute top-4 right-4">
                  <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
                    {day.category}
                  </Badge>
                </div>
              </div>

              <div className="p-8">
                <h1 className="text-3xl font-semibold tracking-tight mb-2">{day.title}</h1>
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    {dateStr}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" />
                    {day.location}
                  </span>
                </div>

                {day.description && (
                  <p className="text-muted-foreground leading-relaxed mb-6">{day.description}</p>
                )}

                <div className="grid grid-cols-2 gap-4 pt-6 border-t border-border">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected reach</p>
                    <p className="font-semibold text-lg mt-1">{day.expected_reach}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open auctions</p>
                    <p className="font-semibold text-lg mt-1">{openAuctions}</p>
                  </div>
                </div>
              </div>
            </div>

            {day.creator_profiles && (
              <div className="mt-6 rounded-2xl border border-border bg-card p-6">
                <h2 className="font-semibold mb-4">About the creator</h2>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center text-background text-xl font-bold">
                    {day.profiles?.name?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">@{day.profiles?.username || day.profiles?.name}</p>
                    <p className="text-sm text-muted-foreground">{day.creator_profiles.occupation}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {day.creator_profiles.location} {day.creator_profiles.country_code}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {day.creator_profiles.followers}
                      </span>
                    </div>
                  </div>
                </div>
                {day.creator_profiles.audience_description && (
                  <p className="mt-4 text-sm text-muted-foreground italic">
                    &ldquo;{day.creator_profiles.audience_description}&rdquo;
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="rounded-2xl border border-border bg-card p-6 sticky top-24">
              <h2 className="font-semibold text-lg mb-1">Sponsorship auctions</h2>
              <p className="text-sm text-muted-foreground mb-4">Bid on a slot for this day</p>

              <div className="space-y-3">
                {slots.map((slot) => (
                  <div key={slot.id}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                      <span className="text-lg">{tierIcons[slot.tier]}</span>
                      <span className="font-semibold text-foreground">{slot.tier} Sponsor</span>
                    </div>
                    {slot.description || tierDescriptions[slot.tier] ? (
                      <p className="text-xs text-muted-foreground mb-2">
                        {slot.description || tierDescriptions[slot.tier]}
                      </p>
                    ) : null}
                    <AuctionPanel
                      slot={slot}
                      onSubmitBid={handlePlaceBid}
                      onAuctionElapsed={handleElapsed}
                      isOwnDay={isOwnDay}
                    />
                  </div>
                ))}
              </div>

              {isOwnDay && (
                <div className="mt-4 p-3 rounded-lg bg-secondary text-sm text-muted-foreground text-center">
                  This is your day — you can&apos;t sponsor it.
                </div>
              )}

              {slots.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No slots available yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
