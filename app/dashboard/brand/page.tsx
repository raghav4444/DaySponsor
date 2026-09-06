'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Target, DollarSign, TrendingUp, Package, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Sponsorship, type Day, type Profile } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Campaign = Sponsorship & {
  days: Day;
  profiles: { name: string; username: string | null };
};

export default function BrandDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.id) loadCampaigns(profile.id);
  }, [profile?.id]);

  const loadCampaigns = async (profileId: string) => {
    setLoading(true);

    const { data, error } = await supabase
      .from('sponsorships')
      .select(`
        *,
        days!inner(
          id, title, day_date, location, category
        ),
        profiles!sponsorships_creator_id_fkey(name, username)
      `)
      .eq('brand_id', profileId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading campaigns:', error);
      setLoading(false);
      return;
    }

    setCampaigns((data || []) as unknown as Campaign[]);
    setLoading(false);
  };

  if (authLoading || (!user && !authLoading)) {
    if (!user && !authLoading) {
      return (
        <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
          <p className="text-lg font-medium text-muted-foreground">Please sign in</p>
          <Link href="/login"><Button>Sign in</Button></Link>
        </div>
      );
    }
    return <div className="min-h-screen pt-20 flex items-center justify-center"><p className="text-muted-foreground animate-pulse">Loading...</p></div>;
  }

  if (profile?.role === 'creator') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">This is the brand dashboard</p>
        <Link href="/dashboard/creator"><Button>Go to creator dashboard</Button></Link>
      </div>
    );
  }

  const totalSpent = campaigns.reduce((sum, c) => sum + c.amount, 0);
  const activeCampaigns = campaigns.filter((c) => c.status !== 'completed' && c.status !== 'cancelled' && c.status !== 'refunded').length;
  const completedCampaigns = campaigns.filter((c) => c.status === 'completed').length;

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Good morning, {profile?.name?.split(' ')[0] || 'Brand'}
            </h1>
            <p className="text-muted-foreground mt-1">Your sponsorship campaigns</p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/explore">
              <Target className="mr-2 h-4 w-4" />
              Find creators
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <StatCard label="Total invested" value={`€${totalSpent.toLocaleString()}`} icon={DollarSign} color="text-accent" />
          <StatCard label="Active campaigns" value={String(activeCampaigns)} icon={TrendingUp} color="text-blue-500" />
          <StatCard label="Completed" value={String(completedCampaigns)} icon={Package} color="text-amber-500" />
        </div>

        <div>
          <h2 className="font-semibold text-lg mb-4">Your campaigns</h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-xl border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Target className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-lg font-medium text-muted-foreground mb-2">No campaigns yet</p>
              <p className="text-sm text-muted-foreground mb-6">Find a creator and sponsor their day to get started.</p>
              <Button asChild className="rounded-full">
                <Link href="/explore">
                  Explore days
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((sp) => {
                const dateStr = new Date(sp.days.day_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const statusColors: Record<string, string> = {
                  pending: 'bg-amber-500/10 text-amber-600',
                  paid: 'bg-blue-500/10 text-blue-600',
                  product_shipped: 'bg-blue-500/10 text-blue-600',
                  product_received: 'bg-blue-500/10 text-blue-600',
                  day_completed: 'bg-accent/10 text-accent',
                  review_pending: 'bg-amber-500/10 text-amber-600',
                  completed: 'bg-accent/10 text-accent',
                  cancelled: 'bg-red-500/10 text-red-600',
                  refunded: 'bg-red-500/10 text-red-600',
                };

                return (
                  <Link key={sp.id} href={`/dashboard/brand/campaigns/${sp.id}`}>
                    <div className="rounded-xl border border-border bg-card p-5 hover:shadow-md transition-all group cursor-pointer">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-foreground flex items-center justify-center text-background font-bold text-sm">
                            {(sp.profiles?.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold">{sp.profiles?.name || 'Creator'}</p>
                            <p className="text-sm text-muted-foreground">
                              @{sp.profiles?.username || 'creator'} · {dateStr}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">€{sp.amount}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{sp.days.title}</p>
                        <div className="flex items-center gap-2">
                          <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize', statusColors[sp.status] || 'bg-secondary text-muted-foreground')}>
                            {sp.status.replace('_', ' ')}
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
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
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={cn('h-5 w-5', color)} />
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
