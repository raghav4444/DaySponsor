'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Calendar, DollarSign, TrendingUp, Clock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Day, type Slot, type Sponsorship } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export default function CreatorDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const [days, setDays] = useState<(Day & { sponsorship_slots: Slot[] })[]>([]);
  const [sponsorships, setSponsorships] = useState<(Sponsorship & { profiles: { name: string; username: string | null } })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.id) loadData(profile.id);
  }, [profile?.id]);

  const loadData = async (profileId: string) => {
    setLoading(true);

    const { data: daysData } = await supabase
      .from('days')
      .select('*, sponsorship_slots(*)')
      .eq('creator_id', profileId)
      .order('created_at', { ascending: false });

    setDays((daysData || []) as (Day & { sponsorship_slots: Slot[] })[]);

    const { data: sponsorData } = await supabase
      .from('sponsorships')
      .select('*, profiles!sponsorships_brand_id_fkey(name, username)')
      .eq('creator_id', profileId)
      .order('created_at', { ascending: false })
      .limit(10);

    setSponsorships((sponsorData || []) as unknown as (Sponsorship & { profiles: { name: string; username: string | null } })[]);
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

  if (profile?.role === 'brand') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">This is the creator dashboard</p>
        <Link href="/dashboard/brand"><Button>Go to brand dashboard</Button></Link>
      </div>
    );
  }

  const totalEarnings = sponsorships.reduce((sum, s) => sum + s.creator_amount, 0);
  const availableAmount = sponsorships
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + s.creator_amount, 0);
  const pendingAmount = sponsorships
    .filter((s) => s.status !== 'completed' && s.status !== 'cancelled' && s.status !== 'refunded')
    .reduce((sum, s) => sum + s.creator_amount, 0);

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Welcome back, {profile?.name?.split(' ')[0] || 'Creator'}
            </h1>
            <p className="text-muted-foreground mt-1">Here&apos;s your sponsorship overview</p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/dashboard/creator/days/new">
              <Plus className="mr-2 h-4 w-4" />
              Create new day
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <StatCard
            label="Total earnings"
            value={`€${totalEarnings.toLocaleString()}`}
            icon={DollarSign}
            color="text-accent"
          />
          <StatCard
            label="Available"
            value={`€${availableAmount.toLocaleString()}`}
            icon={TrendingUp}
            color="text-blue-500"
          />
          <StatCard
            label="Pending"
            value={`€${pendingAmount.toLocaleString()}`}
            icon={Clock}
            color="text-amber-500"
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          <div>
            <h2 className="font-semibold text-lg mb-4">Your days</h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : days.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center">
                <p className="text-muted-foreground mb-4">No days yet. Create your first one!</p>
                <Button asChild className="rounded-full">
                  <Link href="/dashboard/creator/days/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create a day
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {days.map((day) => {
                  const taken = day.sponsorship_slots?.filter((s) => !s.is_available).length || 0;
                  const total = day.sponsorship_slots?.length || 0;
                  const pct = total > 0 ? (taken / total) * 100 : 0;
                  const dateStr = new Date(day.day_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                  return (
                    <Link key={day.id} href={`/days/${day.id}`}>
                      <div className="rounded-xl border border-border bg-card p-4 hover:shadow-md transition-all group">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-semibold">{day.title}</p>
                            <p className="text-sm text-muted-foreground">{dateStr} · {day.location}</p>
                          </div>
                          <Badge variant={day.status === 'live' ? 'default' : 'secondary'} className="capitalize">
                            {day.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">
                            {taken}/{total} sponsored
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h2 className="font-semibold text-lg mb-4">Recent sponsorships</h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : sponsorships.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center">
                <p className="text-muted-foreground">No sponsorships yet. When brands sponsor your days, they&apos;ll appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sponsorships.map((sp) => (
                  <div key={sp.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-sm">
                          {sp.profiles?.name || 'Brand'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sp.profiles?.username ? `@${sp.profiles.username}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">€{sp.amount}</p>
                        <p className="text-xs text-muted-foreground">You get €{sp.creator_amount}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize text-xs">
                      {sp.status.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
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
