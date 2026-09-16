'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  DollarSign,
  TrendingUp,
  Calendar,
  Shield,
  Search,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
  Package,
  Star,
  AlertTriangle,
  Eye,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Profile, type Day, type Sponsorship } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type AdminStats = {
  totalUsers: number;
  totalCreators: number;
  totalBrands: number;
  totalDays: number;
  totalSponsorships: number;
  totalRevenue: number;
  platformFees: number;
  pendingSponsorships: number;
  completedSponsorships: number;
};

type SponsorshipRow = Sponsorship & {
  days: { title: string; day_date: string };
  brand_profile: { name: string; username: string | null };
  creator_profile: { name: string; username: string | null };
};

export default function AdminDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [sponsorships, setSponsorships] = useState<SponsorshipRow[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'sponsorships' | 'days'>('overview');
  const [userSearch, setUserSearch] = useState('');
  const [sponsorSearch, setSponsorSearch] = useState('');

  useEffect(() => {
    if (profile?.role === 'admin') loadAdminData();
  }, [profile?.role]);

  const loadAdminData = async () => {
    setLoading(true);

    const [profilesRes, daysRes, sponsorshipsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('days').select('*').order('created_at', { ascending: false }),
      supabase
        .from('sponsorships')
        .select(`
          *,
          days!inner(title, day_date),
          brand_profile:profiles!sponsorships_brand_id_fkey(name, username),
          creator_profile:profiles!sponsorships_creator_id_fkey(name, username)
        `)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const allProfiles = (profilesRes.data || []) as Profile[];
    const allDays = (daysRes.data || []) as Day[];
    const allSponsorships = (sponsorshipsRes.data || []) as unknown as SponsorshipRow[];

    const totalRevenue = allSponsorships.reduce((s, sp) => s + sp.amount, 0);
    const platformFees = allSponsorships.reduce((s, sp) => s + sp.platform_fee, 0);

    setStats({
      totalUsers: allProfiles.length,
      totalCreators: allProfiles.filter((p) => p.role === 'creator').length,
      totalBrands: allProfiles.filter((p) => p.role === 'brand').length,
      totalDays: allDays.length,
      totalSponsorships: allSponsorships.length,
      totalRevenue,
      platformFees,
      pendingSponsorships: allSponsorships.filter((s) => s.status === 'pending' || s.status === 'paid').length,
      completedSponsorships: allSponsorships.filter((s) => s.status === 'completed').length,
    });

    setUsers(allProfiles);
    setDays(allDays);
    setSponsorships(allSponsorships);
    setLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user || profile?.role !== 'admin') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
          <Shield className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-xl font-semibold">Access denied</p>
        <p className="text-muted-foreground text-sm">This page is restricted to administrators.</p>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    );
  }

  const filteredUsers = users.filter(
    (u) =>
      !userSearch ||
      u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.username?.toLowerCase().includes(userSearch.toLowerCase()),
  );

  const filteredSponsorships = sponsorships.filter(
    (s) =>
      !sponsorSearch ||
      s.brand_profile?.name?.toLowerCase().includes(sponsorSearch.toLowerCase()) ||
      s.creator_profile?.name?.toLowerCase().includes(sponsorSearch.toLowerCase()) ||
      s.days?.title?.toLowerCase().includes(sponsorSearch.toLowerCase()),
  );

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-500/10 text-amber-600',
    paid: 'bg-blue-500/10 text-blue-600',
    product_shipped: 'bg-blue-500/10 text-blue-600',
    product_received: 'bg-blue-500/10 text-blue-600',
    day_completed: 'bg-accent/10 text-accent',
    review_pending: 'bg-amber-500/10 text-amber-600',
    completed: 'bg-accent/10 text-accent',
    cancelled: 'bg-destructive/10 text-destructive',
    refunded: 'bg-destructive/10 text-destructive',
  };

  const tabs = [
    { key: 'overview', label: 'Overview', icon: BarChart3 },
    { key: 'users', label: `Users (${stats?.totalUsers ?? '…'})`, icon: Users },
    { key: 'sponsorships', label: `Sponsorships (${stats?.totalSponsorships ?? '…'})`, icon: DollarSign },
    { key: 'days', label: `Days (${stats?.totalDays ?? '…'})`, icon: Calendar },
  ] as const;

  return (
    <div className="min-h-screen pt-20 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-up opacity-0-init">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
              <p className="text-sm text-muted-foreground">Platform overview &amp; management</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider text-accent border-accent/30">
            Admin
          </Badge>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-secondary mb-8 w-fit animate-fade-up opacity-0-init delay-100">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                activeTab === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-up opacity-0-init delay-200">
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="h-28 rounded-2xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <AdminStatCard label="Total users" value={String(stats!.totalUsers)} icon={Users} color="text-accent" sub={`${stats!.totalCreators} creators · ${stats!.totalBrands} brands`} />
                  <AdminStatCard label="Total revenue" value={`€${stats!.totalRevenue.toLocaleString()}`} icon={DollarSign} color="text-accent" sub={`€${stats!.platformFees.toLocaleString()} platform fees`} />
                  <AdminStatCard label="Sponsorships" value={String(stats!.totalSponsorships)} icon={TrendingUp} color="text-blue-500" sub={`${stats!.completedSponsorships} completed`} />
                  <AdminStatCard label="Days listed" value={String(stats!.totalDays)} icon={Calendar} color="text-amber-500" sub="across all creators" />
                </div>

                <div className="grid lg:grid-cols-3 gap-4">
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <h3 className="font-semibold text-sm">Needs attention</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Pending sponsorships</span>
                        <span className="font-semibold text-amber-600">{stats!.pendingSponsorships}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Cancelled / refunded</span>
                        <span className="font-semibold text-destructive">
                          {sponsorships.filter((s) => s.status === 'cancelled' || s.status === 'refunded').length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Review pending</span>
                        <span className="font-semibold text-blue-500">
                          {sponsorships.filter((s) => s.status === 'review_pending').length}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Users className="h-4 w-4 text-accent" />
                      <h3 className="font-semibold text-sm">User breakdown</h3>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Creators</span>
                          <span className="font-medium">{stats!.totalCreators}</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full bg-accent transition-all"
                            style={{ width: `${stats!.totalUsers > 0 ? (stats!.totalCreators / stats!.totalUsers) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Brands</span>
                          <span className="font-medium">{stats!.totalBrands}</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all"
                            style={{ width: `${stats!.totalUsers > 0 ? (stats!.totalBrands / stats!.totalUsers) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Star className="h-4 w-4 text-amber-500" />
                      <h3 className="font-semibold text-sm">Completion rate</h3>
                    </div>
                    <div className="flex items-end gap-2 mb-2">
                      <span className="text-4xl font-bold">
                        {stats!.totalSponsorships > 0
                          ? Math.round((stats!.completedSponsorships / stats!.totalSponsorships) * 100)
                          : 0}%
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {stats!.completedSponsorships} of {stats!.totalSponsorships} sponsorships completed
                    </p>
                    <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{
                          width: `${stats!.totalSponsorships > 0 ? (stats!.completedSponsorships / stats!.totalSponsorships) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Recent sponsorships preview */}
                <div className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">Recent sponsorships</h3>
                    <button
                      onClick={() => setActiveTab('sponsorships')}
                      className="text-sm text-accent hover:underline flex items-center gap-1"
                    >
                      View all <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sponsorships.slice(0, 5).map((sp) => (
                      <div key={sp.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center text-xs font-bold">
                            {sp.brand_profile?.name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{sp.brand_profile?.name} → {sp.creator_profile?.name}</p>
                            <p className="text-xs text-muted-foreground">{sp.days?.title}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-sm">€{sp.amount}</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', statusColors[sp.status] || 'bg-secondary text-muted-foreground')}>
                            {sp.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-4 animate-fade-up opacity-0-init delay-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users by name, email, or username…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-border bg-secondary/50">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Joined</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</span>
                </div>
                <div className="divide-y divide-border">
                  {filteredUsers.map((u) => (
                    <div key={u.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-secondary/30 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center text-background text-xs font-bold shrink-0">
                          {u.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{u.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full font-medium capitalize',
                          u.role === 'admin'
                            ? 'bg-destructive/10 text-destructive'
                            : u.role === 'creator'
                            ? 'bg-accent/10 text-accent'
                            : 'bg-blue-500/10 text-blue-600',
                        )}
                      >
                        {u.role}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      </span>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/profile/${u.username || u.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
                {filteredUsers.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">No users found.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sponsorships Tab */}
        {activeTab === 'sponsorships' && (
          <div className="space-y-4 animate-fade-up opacity-0-init delay-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by brand, creator, or day title…"
                value={sponsorSearch}
                onChange={(e) => setSponsorSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-border bg-secondary/50">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Brand → Creator</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Day</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</span>
                </div>
                <div className="divide-y divide-border">
                  {filteredSponsorships.map((sp) => (
                    <div key={sp.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-secondary/30 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{sp.brand_profile?.name}</p>
                        <p className="text-xs text-muted-foreground truncate">→ {sp.creator_profile?.name}</p>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{sp.days?.title}</p>
                      <div className="text-right">
                        <p className="text-sm font-semibold">€{sp.amount}</p>
                        <p className="text-xs text-muted-foreground">+€{sp.platform_fee} fee</p>
                      </div>
                      <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize whitespace-nowrap', statusColors[sp.status] || 'bg-secondary text-muted-foreground')}>
                        {sp.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(sp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
                {filteredSponsorships.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">No sponsorships found.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Days Tab */}
        {activeTab === 'days' && (
          <div className="space-y-4 animate-fade-up opacity-0-init delay-100">
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-border bg-secondary/50">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Day</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</span>
                </div>
                <div className="divide-y divide-border">
                  {days.map((day) => (
                    <div key={day.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-secondary/30 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{day.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{day.location}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">{day.category}</Badge>
                      <span
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full font-medium capitalize',
                          day.status === 'live' ? 'bg-accent/10 text-accent' :
                          day.status === 'completed' ? 'bg-secondary text-muted-foreground' :
                          day.status === 'cancelled' ? 'bg-destructive/10 text-destructive' :
                          'bg-amber-500/10 text-amber-600',
                        )}
                      >
                        {day.status.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(day.day_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
                {days.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">No days found.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminStatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={cn('h-4 w-4', color)} />
      </div>
      <p className="text-3xl font-bold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
