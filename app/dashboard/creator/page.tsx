'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Plus,
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Sparkles,
  User,
  Star,
  Package,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Day, type Slot, type Sponsorship } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type DayWithSlots = Day & { sponsorship_slots: Slot[] };
type SponsorshipWithBrand = Sponsorship & {
  profiles: { name: string; username: string | null };
};

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/10 text-amber-600' },
  paid: { label: 'Paid', color: 'bg-blue-500/10 text-blue-600' },
  product_shipped: { label: 'Shipped', color: 'bg-blue-500/10 text-blue-600' },
  product_received: { label: 'Received', color: 'bg-blue-500/10 text-blue-600' },
  day_completed: { label: 'Day done', color: 'bg-accent/10 text-accent' },
  review_pending: { label: 'Review pending', color: 'bg-amber-500/10 text-amber-600' },
  completed: { label: 'Completed', color: 'bg-accent/10 text-accent' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive' },
  refunded: { label: 'Refunded', color: 'bg-destructive/10 text-destructive' },
};

export default function CreatorDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const [days, setDays] = useState<DayWithSlots[]>([]);
  const [sponsorships, setSponsorships] = useState<SponsorshipWithBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'days' | 'sponsorships'>('days');

  useEffect(() => {
    if (profile?.id) loadData(profile.id);
  }, [profile?.id]);

  const loadData = async (profileId: string) => {
    setLoading(true);
    const [daysRes, sponsorRes] = await Promise.all([
      supabase
        .from('days')
        .select('*, sponsorship_slots(*)')
        .eq('creator_id', profileId)
        .order('created_at', { ascending: false }),
      supabase
        .from('sponsorships')
        .select('*, profiles!sponsorships_brand_id_fkey(name, username)')
        .eq('creator_id', profileId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    setDays((daysRes.data || []) as DayWithSlots[]);
    setSponsorships((sponsorRes.data || []) as unknown as SponsorshipWithBrand[]);
    setLoading(false);
  };

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
        <Link href="/login"><Button className="rounded-full">Sign in</Button></Link>
      </div>
    );
  }

  if (profile?.role === 'brand') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">This is the creator dashboard</p>
        <Link href="/dashboard/brand"><Button className="rounded-full">Go to brand dashboard</Button></Link>
      </div>
    );
  }

  const totalEarnings = sponsorships.reduce((sum, s) => sum + s.creator_amount, 0);
  const availableAmount = sponsorships
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + s.creator_amount, 0);
  const pendingAmount = sponsorships
    .filter((s) => !['completed', 'cancelled', 'refunded'].includes(s.status))
    .reduce((sum, s) => sum + s.creator_amount, 0);
  const liveDays = days.filter((d) => d.status === 'live').length;
  const reviewsDue = sponsorships.filter((s) => s.status === 'review_pending').length;

  const firstName = profile?.name?.split(' ')[0] || 'Creator';

  return (
    <div className="min-h-screen pt-20 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 animate-fade-up opacity-0-init">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Creator dashboard</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Welcome back, <span className="font-display italic">{firstName}</span>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Your sponsorship overview</p>
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

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-up opacity-0-init delay-100">
          <StatCard
            label="Total earnings"
            value={`€${totalEarnings.toLocaleString()}`}
            icon={DollarSign}
            color="text-accent"
            sub={`€${availableAmount.toLocaleString()} available`}
          />
          <StatCard
            label="Pending payout"
            value={`€${pendingAmount.toLocaleString()}`}
            icon={Clock}
            color="text-amber-500"
            sub="in progress"
          />
          <StatCard
            label="Live days"
            value={String(liveDays)}
            icon={Calendar}
            color="text-blue-500"
            sub={`${days.length} total`}
          />
          <StatCard
            label="Reviews due"
            value={String(reviewsDue)}
            icon={Star}
            color={reviewsDue > 0 ? 'text-amber-500' : 'text-muted-foreground'}
            sub={reviewsDue > 0 ? 'action needed' : 'all caught up'}
          />
        </div>

        {/* Review nudge */}
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
                <p className="text-xs text-muted-foreground">Write your honest review to complete the sponsorship and get paid.</p>
              </div>
            </div>
            <Button size="sm" className="rounded-full shrink-0 bg-amber-500 hover:bg-amber-600 text-white border-0">
              Write review
            </Button>
          </div>
        )}

        {/* Tabs + content */}
        <div className="animate-fade-up opacity-0-init delay-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 p-1 rounded-lg bg-secondary">
              <button
                onClick={() => setActiveTab('days')}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                  activeTab === 'days' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                My days ({days.length})
              </button>
              <button
                onClick={() => setActiveTab('sponsorships')}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                  activeTab === 'sponsorships' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Sponsorships ({sponsorships.length})
              </button>
            </div>
          </div>

          {/* Days tab */}
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
                  <p className="text-sm text-muted-foreground mb-6">Create your first sponsored day and let brands find you.</p>
                  <Button asChild className="rounded-full">
                    <Link href="/dashboard/creator/days/new">
                      <Plus className="mr-2 h-4 w-4" /> Create a day
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {days.map((day) => {
                    const taken = day.sponsorship_slots?.filter((s) => !s.is_available).length || 0;
                    const total = day.sponsorship_slots?.length || 0;
                    const pct = total > 0 ? (taken / total) * 100 : 0;
                    const dateStr = new Date(day.day_date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    });

                    return (
                      <div key={day.id} className="group rounded-2xl border border-border bg-card p-5 hover:border-foreground/20 hover:shadow-sm transition-all">
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold">{day.title}</p>
                              <Badge
                                variant={day.status === 'live' ? 'default' : 'secondary'}
                                className={cn(
                                  'text-xs capitalize',
                                  day.status === 'live' && 'bg-accent/10 text-accent border-accent/20',
                                )}
                              >
                                {day.status === 'live' && (
                                  <span className="mr-1.5 flex h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
                                )}
                                {day.status.replace('_', ' ')}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">{dateStr} · {day.location}</p>
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

                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                            <div
                              className="h-full bg-accent transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                            {taken}/{total} slots filled
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Sponsorships tab */}
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
                  <p className="text-sm text-muted-foreground">When brands sponsor your days, they&apos;ll appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sponsorships.map((sp) => {
                    const status = statusConfig[sp.status] || { label: sp.status, color: 'bg-secondary text-muted-foreground' };
                    const isReviewPending = sp.status === 'review_pending';

                    return (
                      <div
                        key={sp.id}
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
                            <div className="text-right">
                              <p className="font-bold">€{sp.amount}</p>
                              <p className="text-xs text-muted-foreground">You get €{sp.creator_amount}</p>
                            </div>
                            <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap', status.color)}>
                              {status.label}
                            </span>
                          </div>
                        </div>

                        {isReviewPending && (
                          <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-center justify-between">
                            <p className="text-xs text-amber-600 font-medium">Write your review to complete this sponsorship</p>
                            <Button size="sm" className="rounded-full h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0" asChild>
                              <Link href={`/reviews/${sp.id}`}>Write review</Link>
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
