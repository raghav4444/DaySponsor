'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus,
  Calendar,
  DollarSign,
  Clock,
  ArrowRight,
  Sparkles,
  User,
  Star,
  Eye,
  CreditCard,
  Wallet,
  Loader2,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { supabase, type Day, type Slot } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatMinorUnits } from '@/lib/money';
import { StatusBadge } from '@/components/auction/status-badge';
import { loadSlotsForDayWithAuction } from '@/lib/auction-queries';
import type { SlotWithAuction } from '@/lib/auction-queries';

type DayWithSlots = Day & { sponsorship_slots: Slot[] };
type SponsorshipWithBrand = {
  id: string;
  status: string;
  amount: number;
  platform_fee: number;
  creator_amount: number;
  currency: string | null;
  payout_status: string | null;
  payout_released_at: string | null;
  stripe_transfer_id: string | null;
  refund_amount: number | null;
  payment_status: string | null;
  payment_due_at: string | null;
  profiles: { name: string; username: string | null } | null;
};

/**
 * Creator dashboard.
 *
 * Auction state is shown per slot: starting price, highest bid, bid count, end time, and
 * the winning brand once the auction has closed. Earnings are broken out as
 *
 *   Winning bid €500 · DaySponsor fee €50 · Your earnings €450
 *
 * and only money that has actually arrived is counted as available. A sponsorship whose
 * payment has not been confirmed by Stripe is shown as pending, never as earnings the
 * creator could plan around.
 */
export default function CreatorDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [days, setDays] = useState<DayWithSlots[]>([]);
  const [auctionSlots, setAuctionSlots] = useState<Map<string, SlotWithAuction[]>>(new Map());
  const [sponsorships, setSponsorships] = useState<SponsorshipWithBrand[]>([]);
  const [onboarding, setOnboarding] = useState<{
    connected: boolean;
    complete: boolean;
    accountId: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkLoading, setLinkLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'days' | 'sponsorships'>('days');

  const loadData = useCallback(async (profileId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard/creator/data?profileId=${profileId}`);
      if (!response.ok) throw new Error('Failed to fetch dashboard data');

      const payload = (await response.json()) as {
        days: DayWithSlots[];
        sponsorships: SponsorshipWithBrand[];
      };

      setDays(payload.days);
      setSponsorships(payload.sponsorships);

      // Auction columns are loaded through the data layer, the single seam that changes
      // when the generated types land.
      const byDay = new Map<string, SlotWithAuction[]>();
      await Promise.all(
        payload.days.map(async (day) => {
          byDay.set(day.id, await loadSlotsForDayWithAuction(day.id));
        }),
      );
      setAuctionSlots(byDay);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOnboarding = useCallback(async (profileId: string) => {
    const { data } = await supabase
      .from('creator_profiles')
      .select('stripe_account_id, stripe_onboarding_complete')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (data) {
      setOnboarding({
        connected: Boolean(data.stripe_account_id),
        complete: Boolean(data.stripe_onboarding_complete),
        accountId: data.stripe_account_id as string | null,
      });
    } else {
      setOnboarding({ connected: false, complete: false, accountId: null });
    }
  }, []);

  useEffect(() => {
    if (profile?.id) {
      loadData(profile.id);
      loadOnboarding(profile.id);
    }
  }, [profile?.id, loadData, loadOnboarding]);

  const startConnect = useCallback(async () => {
    setLinkLoading(true);
    try {
      const response = await fetch('/api/stripe/connect/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        toast({
          title: 'Could not start onboarding',
          description: payload.error ?? 'Please try again in a moment.',
          variant: 'destructive',
        });
        return;
      }
      window.location.href = payload.url;
    } finally {
      setLinkLoading(false);
    }
  }, [toast]);

  const openDashboard = useCallback(async () => {
    setLinkLoading(true);
    try {
      const response = await fetch('/api/stripe/connect/dashboard-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        toast({
          title: 'Could not open Stripe',
          description: payload.error ?? 'Please try again in a moment.',
          variant: 'destructive',
        });
        return;
      }
      window.open(payload.url, '_blank', 'noopener,noreferrer');
    } finally {
      setLinkLoading(false);
    }
  }, [toast]);

  if (authLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Please sign in</p>
        <Link href="/login">
          <Button className="rounded-full">Sign in</Button>
        </Link>
      </div>
    );
  }

  if (profile?.role === 'brand') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">This is the creator dashboard</p>
        <Link href="/dashboard/brand">
          <Button className="rounded-full">Go to brand dashboard</Button>
        </Link>
      </div>
    );
  }

  // Money that has been confirmed by Stripe and transferred. Unpaid sponsorships are
  // deliberately excluded: showing them as available would let a creator plan around
  // money that may still be refunded or expire unpaid.
  const releasedSponsorships = sponsorships.filter(
    (s) => s.payout_status === 'released' && s.status !== 'refunded',
  );
  const availableAmount = releasedSponsorships.reduce((sum, s) => sum + s.creator_amount, 0);

  const pendingPayout = sponsorships.filter(
    (s) =>
      s.status === 'paid' &&
      s.payout_status !== 'released' &&
      s.payment_status !== 'refunded',
  );
  const pendingAmount = pendingPayout.reduce((sum, s) => sum + s.creator_amount, 0);

  const totalEarnings = sponsorships
    .filter((s) => !['cancelled', 'refunded'].includes(s.status))
    .reduce((sum, s) => sum + s.creator_amount, 0);

  const unpaidButWon = sponsorships.filter((s) => s.status === 'pending');
  const liveDays = days.filter((d) => d.status === 'live').length;
  const reviewsDue = sponsorships.filter((s) => s.status === 'review_pending').length;

  const firstName = profile?.name?.split(' ')[0] || 'Creator';

  return (
    <div className="min-h-screen pt-20 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 animate-fade-up opacity-0-init">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Creator dashboard
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Welcome back, <span className="font-display italic">{firstName}</span>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Your auctions and earnings</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-full" asChild>
              <Link href="/profile">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </Button>
            <Button asChild className="rounded-full">
              <Link href="/dashboard/creator/days/new">
                <Plus className="mr-2 h-4 w-4" />
                New day
              </Link>
            </Button>
          </div>
        </div>

        {/* Stripe Connect status. Without it, a winning auction cannot be paid out. */}
        <ConnectCard
          onboarding={onboarding}
          linkLoading={linkLoading}
          onStart={startConnect}
          onOpenDashboard={openDashboard}
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-up opacity-0-init delay-100">
          <StatCard
            label="Total earnings"
            value={formatMinorUnits(totalEarnings, 'eur')}
            icon={DollarSign}
            color="text-accent"
            sub={`${formatMinorUnits(availableAmount, 'eur')} received`}
          />
          <StatCard
            label="Received"
            value={formatMinorUnits(availableAmount, 'eur')}
            icon={Wallet}
            color="text-accent"
            sub={`${releasedSponsorships.length} payout${releasedSponsorships.length === 1 ? '' : 's'}`}
          />
          <StatCard
            label="Pending payout"
            value={formatMinorUnits(pendingAmount, 'eur')}
            icon={Clock}
            color={pendingAmount > 0 ? 'text-amber-500' : 'text-muted-foreground'}
            sub={
              unpaidButWon.length > 0
                ? `${unpaidButWon.length} awaiting brand payment`
                : pendingAmount > 0
                  ? 'released on schedule'
                  : 'nothing pending'
            }
          />
          <StatCard
            label="Live days"
            value={String(liveDays)}
            icon={Calendar}
            color="text-blue-500"
            sub={`${days.length} total`}
          />
        </div>

        {reviewsDue > 0 && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-4 animate-fade-up opacity-0-init delay-150">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10">
                <Star className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {reviewsDue} review{reviewsDue > 1 ? 's' : ''} waiting
                </p>
                <p className="text-xs text-muted-foreground">
                  Write your honest review to complete the sponsorship.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="rounded-full shrink-0 bg-amber-500 hover:bg-amber-600 text-white border-0"
              asChild
            >
              <Link href={`/reviews/${sponsorships.find((s) => s.status === 'review_pending')?.id ?? ''}`}>
                Write review
              </Link>
            </Button>
          </div>
        )}

        <div className="animate-fade-up opacity-0-init delay-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 p-1 rounded-lg bg-secondary">
              <button
                onClick={() => setActiveTab('days')}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                  activeTab === 'days'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                My days ({days.length})
              </button>
              <button
                onClick={() => setActiveTab('sponsorships')}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                  activeTab === 'sponsorships'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Sponsorships ({sponsorships.length})
              </button>
            </div>
          </div>

          {activeTab === 'days' && (
            <div>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 rounded-2xl border border-border bg-card animate-pulse" />
                  ))}
                </div>
              ) : days.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary mx-auto mb-4">
                    <Calendar className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="text-lg font-semibold mb-1">No days yet</p>
                  <p className="text-sm text-muted-foreground mb-6">
                    Create your first sponsored day and let brands find you.
                  </p>
                  <Button asChild className="rounded-full">
                    <Link href="/dashboard/creator/days/new">
                      <Plus className="mr-2 h-4 w-4" /> Create a day
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {days.map((day) => {
                    const slots = auctionSlots.get(day.id) ?? [];
                    return (
                      <DayRow key={day.id} day={day} slots={slots} />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'sponsorships' && (
            <div>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 rounded-2xl border border-border bg-card animate-pulse" />
                  ))}
                </div>
              ) : sponsorships.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary mx-auto mb-4">
                    <Sparkles className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="text-lg font-semibold mb-1">No sponsorships yet</p>
                  <p className="text-sm text-muted-foreground">
                    When brands win your auctions, they&apos;ll appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sponsorships.map((sp) => (
                    <SponsorshipRow key={sp.id} sp={sp} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={cn('h-4 w-4', color)} />
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function ConnectCard({
  onboarding,
  linkLoading,
  onStart,
  onOpenDashboard,
}: {
  onboarding: { connected: boolean; complete: boolean; accountId: string | null } | null;
  linkLoading: boolean;
  onStart: () => void;
  onOpenDashboard: () => void;
}) {
  if (!onboarding || !onboarding.connected) {
    return (
      <div
        className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-up opacity-0-init delay-75"
        data-testid="connect-card"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <CreditCard className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="font-semibold">Connect your Stripe account</p>
            <p className="text-sm text-muted-foreground">
              Required before a won auction can be paid out to you.
            </p>
          </div>
        </div>
        <Button
          className="rounded-full shrink-0"
          onClick={onStart}
          disabled={linkLoading}
          data-testid="start-connect-button"
        >
          {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start onboarding'}
        </Button>
      </div>
    );
  }

  if (!onboarding.complete) {
    return (
      <div
        className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-up opacity-0-init delay-75"
        data-testid="connect-card"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="font-semibold">Finish your Stripe onboarding</p>
            <p className="text-sm text-muted-foreground">
              Payouts are held until Stripe confirms your details.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="rounded-full shrink-0"
          onClick={onStart}
          disabled={linkLoading}
          data-testid="resume-connect-button"
        >
          {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Resume onboarding'}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="mb-8 rounded-2xl border border-accent/30 bg-accent/5 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-up opacity-0-init delay-75"
      data-testid="connect-card"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
          <CheckCircle2 className="h-5 w-5 text-accent" />
        </div>
        <div>
          <p className="font-semibold">Stripe connected</p>
          <p className="text-sm text-muted-foreground">
            {onboarding.accountId} · payouts are released automatically once a sponsorship is paid
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        className="rounded-full shrink-0"
        onClick={onOpenDashboard}
        disabled={linkLoading}
      >
        <ExternalLink className="mr-2 h-4 w-4" />
        Open Stripe dashboard
      </Button>
    </div>
  );
}

/**
 * One of the creator's days, with its slots' auction state.
 *
 * The winning brand is shown only after the auction has closed — while it is open, only
 * the highest bid and the bid count are visible.
 */
function DayRow({ day, slots }: { day: DayWithSlots; slots: SlotWithAuction[] }) {
  const dateStr = new Date(day.day_date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const openAuctions = slots.filter((s) => s.auction_status === 'open');
  const closedAuctions = slots.filter((s) =>
    ['closed', 'awaiting_payment', 'paid', 'completed', 'cancelled'].includes(s.auction_status ?? ''),
  );
  const highestOpen = openAuctions.reduce(
    (max, s) => Math.max(max, Number(s.current_highest_bid ?? 0)),
    0,
  );

  return (
    <div className="group rounded-2xl border border-border bg-card p-5 hover:border-foreground/20 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold">{day.title}</p>
            <StatusBadge status={day.status} kind="auction" />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dateStr} · {day.location}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/days/${day.id}`}>
              <Eye className="h-4 w-4" />
            </Link>
          </Button>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {openAuctions.length > 0 && (
          <div className="rounded-lg bg-secondary/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Open auctions
            </p>
            <p className="text-sm font-semibold mt-0.5">
              {openAuctions.length} · highest {formatMinorUnits(highestOpen, 'eur')}
            </p>
          </div>
        )}
        {closedAuctions.length > 0 && (
          <div className="rounded-lg bg-secondary/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Closed</p>
            <p className="text-sm font-semibold mt-0.5">{closedAuctions.length} slot{closedAuctions.length === 1 ? '' : 's'}</p>
          </div>
        )}
        <div className="rounded-lg bg-secondary/50 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Slots</p>
          <p className="text-sm font-semibold mt-0.5">{slots.length} total</p>
        </div>
      </div>

      {slots.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          {slots.map((slot) => (
            <SlotAuctionLine key={slot.id} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single slot's auction summary: start, highest, bids, end, and the winner if closed. */
function SlotAuctionLine({ slot }: { slot: SlotWithAuction }) {
  const currency = slot.currency ?? 'eur';
  const starting = Number(slot.starting_price ?? 0);
  const highest = Number(slot.current_highest_bid ?? 0);
  const closed = slot.auction_status !== 'open';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{slot.tier}</span>
        <StatusBadge status={slot.auction_status} kind="auction" />
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          Start <span className="font-semibold text-foreground">{formatMinorUnits(starting, currency)}</span>
        </span>
        <span>
          Highest <span className="font-semibold text-foreground">{formatMinorUnits(highest, currency)}</span>
        </span>
        {slot.auction_ends_at && !closed && (
          <span>
            ends{' '}
            {new Date(slot.auction_ends_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A sponsorship with the required earnings breakdown:
 *
 *   Winning bid €500 / DaySponsor fee €50 / Your earnings €450
 *
 * Payout status comes from the transfer state written by the payout job — never from a
 * value recomputed in the browser.
 */
function SponsorshipRow({ sp }: { sp: SponsorshipWithBrand }) {
  const currency = sp.currency ?? 'eur';
  const isReviewPending = sp.status === 'review_pending';

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card p-5 transition-all',
        isReviewPending ? 'border-amber-500/30' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-foreground flex items-center justify-center text-background text-sm font-bold shrink-0">
            {(sp.profiles?.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{sp.profiles?.name || 'Brand'}</p>
            {sp.profiles?.username && (
              <p className="text-xs text-muted-foreground">@{sp.profiles.username}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right" data-testid="earnings-breakdown">
            <p className="text-xs text-muted-foreground">
              Winning bid {formatMinorUnits(sp.amount, currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              DaySponsor fee {formatMinorUnits(sp.platform_fee, currency)}
            </p>
            <p className="font-bold">
              Your earnings {formatMinorUnits(sp.creator_amount, currency)}
            </p>
          </div>
          <StatusBadge status={sp.status} kind="sponsorship" />
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-3">
        <StatusBadge status={sp.payout_status} kind="payout" />
        {sp.refund_amount != null && sp.refund_amount > 0 && (
          <StatusBadge status="refunded" kind="refund" />
        )}
        {sp.status === 'pending' && (
          <span className="text-xs text-amber-600" data-testid="unpaid-notice">
            Awaiting brand payment
          </span>
        )}
        {sp.payout_status === 'released' && sp.payout_released_at && (
          <span className="text-xs text-accent">
            Paid out {new Date(sp.payout_released_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        )}
      </div>

      {isReviewPending && (
        <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-center justify-between">
          <p className="text-xs text-amber-600 font-medium">
            Write your review to complete this sponsorship
          </p>
          <Button
            size="sm"
            className="rounded-full h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0"
            asChild
          >
            <Link href={`/reviews/${sp.id}`}>Write review</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
