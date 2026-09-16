'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Target,
  DollarSign,
  TrendingUp,
  Package,
  ArrowRight,
  Plus,
  CheckCircle2,
  Clock,
  XCircle,
  Sparkles,
  BarChart3,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Sponsorship, type Day } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Campaign = Sponsorship & {
  days: Day;
  profiles: { name: string; username: string | null };
};

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/10 text-amber-600', icon: Clock },
  paid: { label: 'Paid', color: 'bg-blue-500/10 text-blue-600', icon: CheckCircle2 },
  product_shipped: { label: 'Shipped', color: 'bg-blue-500/10 text-blue-600', icon: Package },
  product_received: { label: 'Received', color: 'bg-blue-500/10 text-blue-600', icon: Package },
  day_completed: { label: 'Day done', color: 'bg-accent/10 text-accent', icon: CheckCircle2 },
  review_pending: { label: 'Review pending', color: 'bg-amber-500/10 text-amber-600', icon: Clock },
  completed: { label: 'Completed', color: 'bg-accent/10 text-accent', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive', icon: XCircle },
  refunded: { label: 'Refunded', color: 'bg-destructive/10 text-destructive', icon: XCircle },
};

export default function BrandDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  useEffect(() => {
    if (profile?.id) loadCampaigns(profile.id);
  }, [profile?.id]);

  const loadCampaigns = async (profileId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sponsorships')
      .select(`
        *,
        days!inner(id, title, day_date, location, category),
        profiles!sponsorships_creator_id_fkey(name, username)
      `)
      .eq('brand_id', profileId)
      .order('created_at', { ascending: false });

    if (!error) setCampaigns((data || []) as unknown as Campaign[]);
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

  if (profile?.role === 'creator') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">This is the brand dashboard</p>
        <Link href="/dashboard/creator"><Button className="rounded-full">Go to creator dashboard</Button></Link>
      </div>
    );
  }

  const totalSpent = campaigns.reduce((sum, c) => sum + c.amount, 0);
  const activeCampaigns = campaigns.filter(
    (c) => !['completed', 'cancelled', 'refunded'].includes(c.status),
  );
  const completedCampaigns = campaigns.filter((c) => c.status === 'completed');
  const platformFees = campaigns.reduce((sum, c) => sum + c.platform_fee, 0);

  const filtered =
    filter === 'active'
      ? activeCampaigns
      : filter === 'completed'
      ? completedCampaigns
      : campaigns;

  const firstName = profile?.name?.split(' ')[0] || 'Brand';

  return (
    <div className="min-h-screen pt-20 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 animate-fade-up opacity-0-init">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Brand dashboard</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Good to see you, <span className="font-display italic">{firstName}</span>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Track your sponsorship campaigns and ROI</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-full" asChild>
              <Link href="/profile">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </Button>
            <Button asChild className="rounded-full">
              <Link href="/explore">
                <Target className="mr-2 h-4 w-4" />
                Find creators
              </Link>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-up opacity-0-init delay-100">
          <StatCard
            label="Total invested"
            value={`€${totalSpent.toLocaleString()}`}
            icon={DollarSign}
            color="text-accent"
            sub={`€${platformFees.toLocaleString()} platform fees`}
          />
          <StatCard
            label="Active campaigns"
            value={String(activeCampaigns.length)}
            icon={TrendingUp}
            color="text-blue-500"
            sub="in progress"
          />
          <StatCard
            label="Completed"
            value={String(completedCampaigns.length)}
            icon={CheckCircle2}
            color="text-accent"
            sub="with reviews"
          />
          <StatCard
            label="Creators reached"
            value={String(new Set(campaigns.map((c) => c.creator_id)).size)}
            icon={Sparkles}
            color="text-amber-500"
            sub="unique creators"
          />
        </div>

        {/* Campaigns */}
        <div className="animate-fade-up opacity-0-init delay-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Your campaigns</h2>
            <div className="flex gap-1 p-1 rounded-lg bg-secondary">
              {(['all', 'active', 'completed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize',
                    filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-2xl border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary mx-auto mb-4">
                <Target className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-lg font-semibold mb-1">
                {filter === 'all' ? 'No campaigns yet' : `No ${filter} campaigns`}
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                {filter === 'all'
                  ? 'Find a creator and sponsor their day to get started.'
                  : 'Try switching the filter above.'}
              </p>
              {filter === 'all' && (
                <Button asChild className="rounded-full">
                  <Link href="/explore">
                    Explore days <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((sp) => {
                const dateStr = new Date(sp.days.day_date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const status = statusConfig[sp.status] || { label: sp.status, color: 'bg-secondary text-muted-foreground', icon: Clock };
                const StatusIcon = status.icon;

                return (
                  <Link key={sp.id} href={`/dashboard/brand/campaigns/${sp.id}`}>
                    <div className="group rounded-2xl border border-border bg-card p-5 hover:border-foreground/20 hover:shadow-sm transition-all cursor-pointer">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="h-11 w-11 rounded-xl bg-foreground flex items-center justify-center text-background font-bold text-base shrink-0">
                            {(sp.profiles?.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{sp.days.title}</p>
                            <p className="text-sm text-muted-foreground">
                              @{sp.profiles?.username || sp.profiles?.name} · {dateStr}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="font-bold text-lg">€{sp.amount}</p>
                            <p className="text-xs text-muted-foreground">{sp.days.category}</p>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <StatusIcon className="h-3.5 w-3.5" />
                          <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', status.color)}>
                            {status.label}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {sp.days.location}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* CTA if no campaigns */}
        {campaigns.length > 0 && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-up opacity-0-init delay-300">
            <div>
              <p className="font-semibold">Ready to sponsor another day?</p>
              <p className="text-sm text-muted-foreground">Browse creators and find the perfect fit for your product.</p>
            </div>
            <Button asChild className="rounded-full shrink-0">
              <Link href="/explore">
                <Plus className="mr-2 h-4 w-4" />
                Explore creators
              </Link>
            </Button>
          </div>
        )}
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
