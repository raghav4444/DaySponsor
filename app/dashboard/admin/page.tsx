'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Star,
  AlertTriangle,
  Eye,
  MoreHorizontal,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  Trash2,
  UserCog,
  Ban,
  CheckCheck,
  ExternalLink,
  X,
  TrendingDown,
  Activity,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Profile, type Day, type Sponsorship } from '@/lib/supabase';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  cancelledSponsorships: number;
  avgDealSize: number;
};

type SponsorshipRow = Sponsorship & {
  days: { title: string; day_date: string; id: string };
  brand_profile: { name: string; username: string | null; id: string };
  creator_profile: { name: string; username: string | null; id: string };
};

type Toast = { id: number; message: string; type: 'success' | 'error' };

const PAGE_SIZE = 20;

const SPONSORSHIP_STATUSES = [
  'pending', 'paid', 'product_shipped', 'product_received',
  'day_completed', 'review_pending', 'completed', 'cancelled', 'refunded',
] as const;

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

const dayStatusColors: Record<string, string> = {
  live: 'bg-accent/10 text-accent',
  draft: 'bg-amber-500/10 text-amber-600',
  full: 'bg-blue-500/10 text-blue-600',
  in_progress: 'bg-blue-500/10 text-blue-600',
  completed: 'bg-secondary text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user, profile, loading: authLoading } = useAuth();

  // Data
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [sponsorships, setSponsorships] = useState<SponsorshipRow[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'sponsorships' | 'days' | 'analytics'>('overview');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Search & filter
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [sponsorSearch, setSponsorSearch] = useState('');
  const [sponsorStatusFilter, setSponsorStatusFilter] = useState<string>('all');
  const [daySearch, setDaySearch] = useState('');
  const [dayStatusFilter, setDayStatusFilter] = useState<string>('all');

  // Pagination
  const [userPage, setUserPage] = useState(1);
  const [sponsorPage, setSponsorPage] = useState(1);
  const [dayPage, setDayPage] = useState(1);

  // Modals
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    action: () => Promise<void>;
    variant?: 'destructive' | 'default';
  } | null>(null);
  const [sponsorDetailModal, setSponsorDetailModal] = useState<SponsorshipRow | null>(null);
  const [dayDetailModal, setDayDetailModal] = useState<Day | null>(null);
  const [statusChangeModal, setStatusChangeModal] = useState<{ sponsorship: SponsorshipRow; newStatus: string } | null>(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadAdminData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    const [profilesRes, daysRes, sponsorshipsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('days').select('*').order('created_at', { ascending: false }),
      supabase
        .from('sponsorships')
        .select(`
          *,
          days!inner(id, title, day_date),
          brand_profile:profiles!sponsorships_brand_id_fkey(id, name, username),
          creator_profile:profiles!sponsorships_creator_id_fkey(id, name, username)
        `)
        .order('created_at', { ascending: false }),
    ]);

    const allProfiles = (profilesRes.data || []) as Profile[];
    const allDays = (daysRes.data || []) as Day[];
    const allSponsorships = (sponsorshipsRes.data || []) as unknown as SponsorshipRow[];

    const totalRevenue = allSponsorships.reduce((s, sp) => s + sp.amount, 0);
    const platformFees = allSponsorships.reduce((s, sp) => s + sp.platform_fee, 0);
    const completed = allSponsorships.filter((s) => s.status === 'completed');

    setStats({
      totalUsers: allProfiles.length,
      totalCreators: allProfiles.filter((p) => p.role === 'creator').length,
      totalBrands: allProfiles.filter((p) => p.role === 'brand').length,
      totalDays: allDays.length,
      totalSponsorships: allSponsorships.length,
      totalRevenue,
      platformFees,
      pendingSponsorships: allSponsorships.filter((s) => s.status === 'pending' || s.status === 'paid').length,
      completedSponsorships: completed.length,
      cancelledSponsorships: allSponsorships.filter((s) => s.status === 'cancelled' || s.status === 'refunded').length,
      avgDealSize: allSponsorships.length > 0 ? Math.round(totalRevenue / allSponsorships.length) : 0,
    });

    setUsers(allProfiles);
    setDays(allDays);
    setSponsorships(allSponsorships);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') loadAdminData();
  }, [profile?.role, loadAdminData]);

  // ── Toast helpers ────────────────────────────────────────────────────────────

  const addToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  };

  // ── User actions ─────────────────────────────────────────────────────────────

  const changeUserRole = async (userId: string, newRole: 'creator' | 'brand' | 'admin') => {
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    if (error) { addToast('Failed to update role', 'error'); return; }
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    addToast(`Role updated to ${newRole}`);
  };

  const deleteUser = async (userId: string) => {
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) { addToast('Failed to delete user', 'error'); return; }
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    addToast('User deleted');
  };

  // ── Sponsorship actions ──────────────────────────────────────────────────────

  const updateSponsorshipStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase.from('sponsorships').update({ status: newStatus }).eq('id', id);
    if (error) { addToast('Failed to update status', 'error'); return; }
    setSponsorships((prev) => prev.map((s) => s.id === id ? { ...s, status: newStatus as Sponsorship['status'] } : s));
    if (sponsorDetailModal?.id === id) setSponsorDetailModal((prev) => prev ? { ...prev, status: newStatus as Sponsorship['status'] } : null);
    addToast(`Status updated to ${newStatus.replace(/_/g, ' ')}`);
  };

  const deleteSponsorshipRecord = async (id: string) => {
    const { error } = await supabase.from('sponsorships').delete().eq('id', id);
    if (error) { addToast('Failed to delete sponsorship', 'error'); return; }
    setSponsorships((prev) => prev.filter((s) => s.id !== id));
    addToast('Sponsorship deleted');
  };

  // ── Day actions ──────────────────────────────────────────────────────────────

  const updateDayStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase.from('days').update({ status: newStatus }).eq('id', id);
    if (error) { addToast('Failed to update day status', 'error'); return; }
    setDays((prev) => prev.map((d) => d.id === id ? { ...d, status: newStatus as Day['status'] } : d));
    if (dayDetailModal?.id === id) setDayDetailModal((prev) => prev ? { ...prev, status: newStatus as Day['status'] } : null);
    addToast(`Day status updated to ${newStatus.replace(/_/g, ' ')}`);
  };

  const deleteDay = async (id: string) => {
    const { error } = await supabase.from('days').delete().eq('id', id);
    if (error) { addToast('Failed to delete day', 'error'); return; }
    setDays((prev) => prev.filter((d) => d.id !== id));
    addToast('Day deleted');
  };

  // ── CSV Export ───────────────────────────────────────────────────────────────

  const exportCSV = (data: Record<string, unknown>[], filename: string) => {
    if (!data.length) return;
    const keys = Object.keys(data[0]);
    const rows = [keys.join(','), ...data.map((row) => keys.map((k) => JSON.stringify(row[k] ?? '')).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    addToast(`Exported ${data.length} rows`);
  };

  const exportUsers = () => exportCSV(
    filteredUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, role: u.role, created_at: u.created_at })),
    'users.csv',
  );

  const exportSponsorships = () => exportCSV(
    filteredSponsorships.map((s) => ({
      id: s.id,
      brand: s.brand_profile?.name,
      creator: s.creator_profile?.name,
      day: s.days?.title,
      amount: s.amount,
      platform_fee: s.platform_fee,
      status: s.status,
      created_at: s.created_at,
    })),
    'sponsorships.csv',
  );

  // ── Analytics helpers ────────────────────────────────────────────────────────

  const getMonthlyRevenue = () => {
    const map: Record<string, number> = {};
    sponsorships.forEach((s) => {
      const month = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      map[month] = (map[month] || 0) + s.amount;
    });
    return Object.entries(map).slice(-6).map(([month, revenue]) => ({ month, revenue }));
  };

  const getTopCreators = () => {
    const map: Record<string, { name: string; revenue: number; count: number }> = {};
    sponsorships.forEach((s) => {
      const id = s.creator_id;
      if (!map[id]) map[id] = { name: s.creator_profile?.name || 'Unknown', revenue: 0, count: 0 };
      map[id].revenue += s.amount;
      map[id].count += 1;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  };

  const getTopBrands = () => {
    const map: Record<string, { name: string; spent: number; count: number }> = {};
    sponsorships.forEach((s) => {
      const id = s.brand_id;
      if (!map[id]) map[id] = { name: s.brand_profile?.name || 'Unknown', spent: 0, count: 0 };
      map[id].spent += s.amount;
      map[id].count += 1;
    });
    return Object.values(map).sort((a, b) => b.spent - a.spent).slice(0, 5);
  };

  // ── Filtered & paginated data ────────────────────────────────────────────────

  const filteredUsers = users.filter((u) => {
    const matchSearch = !userSearch ||
      u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.username?.toLowerCase().includes(userSearch.toLowerCase());
    const matchRole = userRoleFilter === 'all' || u.role === userRoleFilter;
    return matchSearch && matchRole;
  });

  const filteredSponsorships = sponsorships.filter((s) => {
    const matchSearch = !sponsorSearch ||
      s.brand_profile?.name?.toLowerCase().includes(sponsorSearch.toLowerCase()) ||
      s.creator_profile?.name?.toLowerCase().includes(sponsorSearch.toLowerCase()) ||
      s.days?.title?.toLowerCase().includes(sponsorSearch.toLowerCase());
    const matchStatus = sponsorStatusFilter === 'all' || s.status === sponsorStatusFilter;
    return matchSearch && matchStatus;
  });

  const filteredDays = days.filter((d) => {
    const matchSearch = !daySearch ||
      d.title?.toLowerCase().includes(daySearch.toLowerCase()) ||
      d.location?.toLowerCase().includes(daySearch.toLowerCase()) ||
      d.category?.toLowerCase().includes(daySearch.toLowerCase());
    const matchStatus = dayStatusFilter === 'all' || d.status === dayStatusFilter;
    return matchSearch && matchStatus;
  });

  const paginate = <T,>(arr: T[], page: number) => arr.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = (arr: unknown[]) => Math.max(1, Math.ceil(arr.length / PAGE_SIZE));

  const pagedUsers = paginate(filteredUsers, userPage);
  const pagedSponsorships = paginate(filteredSponsorships, sponsorPage);
  const pagedDays = paginate(filteredDays, dayPage);

  // ── Auth guard ───────────────────────────────────────────────────────────────

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

  const tabs = [
    { key: 'overview', label: 'Overview', icon: BarChart3 },
    { key: 'analytics', label: 'Analytics', icon: TrendingUp },
    { key: 'users', label: `Users (${stats?.totalUsers ?? '…'})`, icon: Users },
    { key: 'sponsorships', label: `Sponsorships (${stats?.totalSponsorships ?? '…'})`, icon: DollarSign },
    { key: 'days', label: `Days (${stats?.totalDays ?? '…'})`, icon: Calendar },
  ] as const;

  const monthlyRevenue = getMonthlyRevenue();
  const topCreators = getTopCreators();
  const topBrands = getTopBrands();
  const maxRevenue = Math.max(...monthlyRevenue.map((m) => m.revenue), 1);

  return (
    <div className="min-h-screen pt-20 bg-background">
      {/* Toast notifications */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto animate-fade-up',
              t.type === 'success' ? 'bg-foreground text-background' : 'bg-destructive text-white',
            )}
          >
            {t.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
              <p className="text-sm text-muted-foreground">Full platform control</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider text-accent border-accent/30">
              Admin
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full gap-2"
              onClick={() => loadAdminData(true)}
              disabled={refreshing}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-secondary mb-8 w-fit overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
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

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-2xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <AdminStatCard label="Total users" value={String(stats!.totalUsers)} icon={Users} color="text-accent"
                    sub={`${stats!.totalCreators} creators · ${stats!.totalBrands} brands`} />
                  <AdminStatCard label="Total revenue" value={`€${stats!.totalRevenue.toLocaleString()}`} icon={DollarSign} color="text-accent"
                    sub={`€${stats!.platformFees.toLocaleString()} platform fees`} />
                  <AdminStatCard label="Sponsorships" value={String(stats!.totalSponsorships)} icon={TrendingUp} color="text-blue-500"
                    sub={`${stats!.completedSponsorships} completed`} />
                  <AdminStatCard label="Avg deal size" value={`€${stats!.avgDealSize}`} icon={Zap} color="text-amber-500"
                    sub="per sponsorship" />
                </div>

                {/* Secondary cards */}
                <div className="grid lg:grid-cols-3 gap-4">
                  {/* Needs attention */}
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <h3 className="font-semibold text-sm">Needs attention</h3>
                    </div>
                    <div className="space-y-3">
                      {[
                        { label: 'Pending sponsorships', value: stats!.pendingSponsorships, color: 'text-amber-600' },
                        { label: 'Cancelled / refunded', value: stats!.cancelledSponsorships, color: 'text-destructive' },
                        { label: 'Review pending', value: sponsorships.filter((s) => s.status === 'review_pending').length, color: 'text-blue-500' },
                        { label: 'Draft days', value: days.filter((d) => d.status === 'draft').length, color: 'text-muted-foreground' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{item.label}</span>
                          <span className={cn('font-semibold', item.color)}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* User breakdown */}
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Users className="h-4 w-4 text-accent" />
                      <h3 className="font-semibold text-sm">User breakdown</h3>
                    </div>
                    <div className="space-y-3">
                      {[
                        { label: 'Creators', count: stats!.totalCreators, color: 'bg-accent' },
                        { label: 'Brands', count: stats!.totalBrands, color: 'bg-blue-500' },
                        { label: 'Admins', count: users.filter((u) => u.role === 'admin').length, color: 'bg-destructive' },
                      ].map((item) => (
                        <div key={item.label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-muted-foreground">{item.label}</span>
                            <span className="font-medium">{item.count}</span>
                          </div>
                          <div className="h-2 rounded-full bg-secondary overflow-hidden">
                            <div
                              className={cn('h-full transition-all', item.color)}
                              style={{ width: `${stats!.totalUsers > 0 ? (item.count / stats!.totalUsers) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Completion rate */}
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
                      {stats!.completedSponsorships} of {stats!.totalSponsorships} completed
                    </p>
                    <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${stats!.totalSponsorships > 0 ? (stats!.completedSponsorships / stats!.totalSponsorships) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Recent sponsorships */}
                <div className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">Recent sponsorships</h3>
                    <button onClick={() => setActiveTab('sponsorships')} className="text-sm text-accent hover:underline flex items-center gap-1">
                      View all <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sponsorships.slice(0, 6).map((sp) => (
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

        {/* ── ANALYTICS TAB ────────────────────────────────────────────────── */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {loading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-64 rounded-2xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {/* Revenue chart */}
                <div className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-2 mb-6">
                    <Activity className="h-4 w-4 text-accent" />
                    <h3 className="font-semibold">Monthly revenue (last 6 months)</h3>
                  </div>
                  {monthlyRevenue.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No revenue data yet.</p>
                  ) : (
                    <div className="flex items-end gap-3 h-40">
                      {monthlyRevenue.map((m) => (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                          <span className="text-xs font-semibold text-accent">€{m.revenue.toLocaleString()}</span>
                          <div
                            className="w-full rounded-t-lg bg-accent/80 hover:bg-accent transition-colors"
                            style={{ height: `${(m.revenue / maxRevenue) * 100}%`, minHeight: '4px' }}
                          />
                          <span className="text-xs text-muted-foreground">{m.month}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  {/* Top creators */}
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp className="h-4 w-4 text-accent" />
                      <h3 className="font-semibold text-sm">Top creators by revenue</h3>
                    </div>
                    <div className="space-y-3">
                      {topCreators.length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
                      {topCreators.map((c, i) => (
                        <div key={c.name} className="flex items-center gap-3">
                          <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                          <div className="h-7 w-7 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">
                            {c.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.count} sponsorships</p>
                          </div>
                          <span className="text-sm font-semibold">€{c.revenue.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top brands */}
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingDown className="h-4 w-4 text-blue-500" />
                      <h3 className="font-semibold text-sm">Top brands by spend</h3>
                    </div>
                    <div className="space-y-3">
                      {topBrands.length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
                      {topBrands.map((b, i) => (
                        <div key={b.name} className="flex items-center gap-3">
                          <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                          <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center text-xs font-bold text-blue-600">
                            {b.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{b.name}</p>
                            <p className="text-xs text-muted-foreground">{b.count} campaigns</p>
                          </div>
                          <span className="text-sm font-semibold">€{b.spent.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Status breakdown */}
                <div className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="h-4 w-4 text-accent" />
                    <h3 className="font-semibold text-sm">Sponsorship status breakdown</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {SPONSORSHIP_STATUSES.map((status) => {
                      const count = sponsorships.filter((s) => s.status === status).length;
                      return (
                        <div key={status} className="rounded-xl border border-border p-3 text-center">
                          <p className="text-2xl font-bold">{count}</p>
                          <p className={cn('text-xs font-medium mt-1 capitalize px-2 py-0.5 rounded-full inline-block', statusColors[status] || 'bg-secondary text-muted-foreground')}>
                            {status.replace(/_/g, ' ')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── USERS TAB ────────────────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by name, email, or username…" value={userSearch}
                  onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }} className="pl-10" />
              </div>
              <div className="flex gap-2">
                <select
                  value={userRoleFilter}
                  onChange={(e) => { setUserRoleFilter(e.target.value); setUserPage(1); }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">All roles</option>
                  <option value="creator">Creator</option>
                  <option value="brand">Brand</option>
                  <option value="admin">Admin</option>
                </select>
                <Button variant="outline" size="sm" className="gap-2 rounded-full" onClick={exportUsers}>
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{filteredUsers.length} users</p>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 border-b border-border bg-secondary/50">
                    {['User', 'Role', 'Joined', 'View', 'Actions'].map((h) => (
                      <span key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                    ))}
                  </div>
                  <div className="divide-y divide-border">
                    {pagedUsers.map((u) => (
                      <div key={u.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center text-background text-xs font-bold shrink-0">
                            {u.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{u.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>
                        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize',
                          u.role === 'admin' ? 'bg-destructive/10 text-destructive' :
                          u.role === 'creator' ? 'bg-accent/10 text-accent' : 'bg-blue-500/10 text-blue-600')}>
                          {u.role}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                        </span>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/profile/${u.username || u.id}`}><Eye className="h-4 w-4" /></Link>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem className="gap-2" onClick={() => setConfirmDialog({
                              open: true, title: 'Change role to Creator',
                              description: `Set ${u.name} as a Creator?`,
                              action: () => changeUserRole(u.id, 'creator'),
                            })}>
                              <UserCog className="h-4 w-4" /> Make Creator
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => setConfirmDialog({
                              open: true, title: 'Change role to Brand',
                              description: `Set ${u.name} as a Brand?`,
                              action: () => changeUserRole(u.id, 'brand'),
                            })}>
                              <UserCog className="h-4 w-4" /> Make Brand
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => setConfirmDialog({
                              open: true, title: 'Change role to Admin',
                              description: `Grant ${u.name} admin access?`,
                              action: () => changeUserRole(u.id, 'admin'),
                            })}>
                              <Shield className="h-4 w-4" /> Make Admin
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              onClick={() => setConfirmDialog({
                                open: true, title: 'Delete user',
                                description: `Permanently delete ${u.name}? This cannot be undone.`,
                                action: () => deleteUser(u.id),
                                variant: 'destructive',
                              })}
                            >
                              <Trash2 className="h-4 w-4" /> Delete user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                  {filteredUsers.length === 0 && (
                    <div className="py-12 text-center text-sm text-muted-foreground">No users found.</div>
                  )}
                </div>
                <Pagination page={userPage} total={totalPages(filteredUsers)} onChange={setUserPage} />
              </>
            )}
          </div>
        )}

        {/* ── SPONSORSHIPS TAB ─────────────────────────────────────────────── */}
        {activeTab === 'sponsorships' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by brand, creator, or day title…" value={sponsorSearch}
                  onChange={(e) => { setSponsorSearch(e.target.value); setSponsorPage(1); }} className="pl-10" />
              </div>
              <div className="flex gap-2">
                <select
                  value={sponsorStatusFilter}
                  onChange={(e) => { setSponsorStatusFilter(e.target.value); setSponsorPage(1); }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">All statuses</option>
                  {SPONSORSHIP_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <Button variant="outline" size="sm" className="gap-2 rounded-full" onClick={exportSponsorships}>
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{filteredSponsorships.length} sponsorships</p>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-4 px-5 py-3 border-b border-border bg-secondary/50">
                    {['Brand → Creator', 'Day', 'Amount', 'Status', 'Date', 'Actions'].map((h) => (
                      <span key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                    ))}
                  </div>
                  <div className="divide-y divide-border">
                    {pagedSponsorships.map((sp) => (
                      <div key={sp.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-secondary/30 transition-colors">
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem className="gap-2" onClick={() => setSponsorDetailModal(sp)}>
                              <Eye className="h-4 w-4" /> View details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <div className="px-2 py-1">
                              <p className="text-xs font-semibold text-muted-foreground mb-1">Change status</p>
                              {SPONSORSHIP_STATUSES.map((s) => (
                                <DropdownMenuItem key={s} className="gap-2 capitalize text-xs"
                                  onClick={() => setConfirmDialog({
                                    open: true,
                                    title: `Update status to "${s.replace(/_/g, ' ')}"`,
                                    description: `Change this sponsorship status to "${s.replace(/_/g, ' ')}"?`,
                                    action: () => updateSponsorshipStatus(sp.id, s),
                                  })}>
                                  {s === sp.status && <CheckCheck className="h-3 w-3 text-accent" />}
                                  {s.replace(/_/g, ' ')}
                                </DropdownMenuItem>
                              ))}
                            </div>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              onClick={() => setConfirmDialog({
                                open: true, title: 'Delete sponsorship',
                                description: 'Permanently delete this sponsorship record? This cannot be undone.',
                                action: () => deleteSponsorshipRecord(sp.id),
                                variant: 'destructive',
                              })}
                            >
                              <Trash2 className="h-4 w-4" /> Delete record
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                  {filteredSponsorships.length === 0 && (
                    <div className="py-12 text-center text-sm text-muted-foreground">No sponsorships found.</div>
                  )}
                </div>
                <Pagination page={sponsorPage} total={totalPages(filteredSponsorships)} onChange={setSponsorPage} />
              </>
            )}
          </div>
        )}

        {/* ── DAYS TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'days' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by title, location, or category…" value={daySearch}
                  onChange={(e) => { setDaySearch(e.target.value); setDayPage(1); }} className="pl-10" />
              </div>
              <select
                value={dayStatusFilter}
                onChange={(e) => { setDayStatusFilter(e.target.value); setDayPage(1); }}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                {['draft', 'live', 'full', 'in_progress', 'completed', 'cancelled'].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            <p className="text-xs text-muted-foreground">{filteredDays.length} days</p>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-5 py-3 border-b border-border bg-secondary/50">
                    {['Day', 'Category', 'Status', 'Date', 'View', 'Actions'].map((h) => (
                      <span key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                    ))}
                  </div>
                  <div className="divide-y divide-border">
                    {pagedDays.map((day) => (
                      <div key={day.id} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-secondary/30 transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{day.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{day.location}</p>
                        </div>
                        <Badge variant="secondary" className="text-xs">{day.category}</Badge>
                        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize', dayStatusColors[day.status] || 'bg-secondary text-muted-foreground')}>
                          {day.status.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(day.day_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/days/${day.id}`} target="_blank"><ExternalLink className="h-4 w-4" /></Link>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem className="gap-2" onClick={() => setDayDetailModal(day)}>
                              <Eye className="h-4 w-4" /> View details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2" onClick={() => setConfirmDialog({
                              open: true, title: 'Set day to Live',
                              description: `Publish "${day.title}" as live?`,
                              action: () => updateDayStatus(day.id, 'live'),
                            })}>
                              <CheckCircle2 className="h-4 w-4 text-accent" /> Set Live
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => setConfirmDialog({
                              open: true, title: 'Set day to Draft',
                              description: `Move "${day.title}" back to draft?`,
                              action: () => updateDayStatus(day.id, 'draft'),
                            })}>
                              <Clock className="h-4 w-4" /> Set Draft
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => setConfirmDialog({
                              open: true, title: 'Mark day as Completed',
                              description: `Mark "${day.title}" as completed?`,
                              action: () => updateDayStatus(day.id, 'completed'),
                            })}>
                              <CheckCheck className="h-4 w-4" /> Mark Completed
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              onClick={() => setConfirmDialog({
                                open: true, title: 'Cancel day',
                                description: `Cancel "${day.title}"? This will mark it as cancelled.`,
                                action: () => updateDayStatus(day.id, 'cancelled'),
                                variant: 'destructive',
                              })}
                            >
                              <Ban className="h-4 w-4" /> Cancel day
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              onClick={() => setConfirmDialog({
                                open: true, title: 'Delete day',
                                description: `Permanently delete "${day.title}"? This cannot be undone.`,
                                action: () => deleteDay(day.id),
                                variant: 'destructive',
                              })}
                            >
                              <Trash2 className="h-4 w-4" /> Delete day
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                  {filteredDays.length === 0 && (
                    <div className="py-12 text-center text-sm text-muted-foreground">No days found.</div>
                  )}
                </div>
                <Pagination page={dayPage} total={totalPages(filteredDays)} onChange={setDayPage} />
              </>
            )}
          </div>
        )}
      </div>

      {/* ── CONFIRM DIALOG ─────────────────────────────────────────────────── */}
      <Dialog open={!!confirmDialog?.open} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription>{confirmDialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button
              variant={confirmDialog?.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={async () => {
                if (confirmDialog?.action) await confirmDialog.action();
                setConfirmDialog(null);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── SPONSORSHIP DETAIL MODAL ────────────────────────────────────────── */}
      <Dialog open={!!sponsorDetailModal} onOpenChange={(open) => !open && setSponsorDetailModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sponsorship details</DialogTitle>
          </DialogHeader>
          {sponsorDetailModal && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Brand', value: sponsorDetailModal.brand_profile?.name },
                  { label: 'Creator', value: sponsorDetailModal.creator_profile?.name },
                  { label: 'Day', value: sponsorDetailModal.days?.title },
                  { label: 'Day date', value: new Date(sponsorDetailModal.days?.day_date).toLocaleDateString() },
                  { label: 'Amount', value: `€${sponsorDetailModal.amount}` },
                  { label: 'Platform fee', value: `€${sponsorDetailModal.platform_fee}` },
                  { label: 'Creator payout', value: `€${sponsorDetailModal.creator_amount}` },
                  { label: 'Created', value: new Date(sponsorDetailModal.created_at).toLocaleDateString() },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                    <p className="font-semibold">{item.value || '—'}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize', statusColors[sponsorDetailModal.status])}>
                  {sponsorDetailModal.status.replace(/_/g, ' ')}
                </span>
              </div>
              {sponsorDetailModal.stripe_payment_intent_id && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Stripe Payment Intent</p>
                  <p className="font-mono text-xs break-all">{sponsorDetailModal.stripe_payment_intent_id}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── DAY DETAIL MODAL ────────────────────────────────────────────────── */}
      <Dialog open={!!dayDetailModal} onOpenChange={(open) => !open && setDayDetailModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Day details</DialogTitle>
          </DialogHeader>
          {dayDetailModal && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Title', value: dayDetailModal.title },
                  { label: 'Category', value: dayDetailModal.category },
                  { label: 'Location', value: dayDetailModal.location },
                  { label: 'Day date', value: new Date(dayDetailModal.day_date).toLocaleDateString() },
                  { label: 'Expected reach', value: dayDetailModal.expected_reach },
                  { label: 'Created', value: new Date(dayDetailModal.created_at).toLocaleDateString() },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                    <p className="font-semibold">{item.value || '—'}</p>
                  </div>
                ))}
              </div>
              {dayDetailModal.description && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-sm leading-relaxed">{dayDetailModal.description}</p>
                </div>
              )}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize', dayStatusColors[dayDetailModal.status])}>
                  {dayDetailModal.status.replace('_', ' ')}
                </span>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm" className="gap-2 rounded-full flex-1">
                  <Link href={`/days/${dayDetailModal.id}`} target="_blank">
                    <ExternalLink className="h-3.5 w-3.5" /> View public page
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AdminStatCard({
  label, value, icon: Icon, color, sub,
}: {
  label: string; value: string; icon: typeof Users; color: string; sub?: string;
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

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2">
      <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" disabled={page === 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">Page {page} of {total}</span>
      <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" disabled={page === total} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
