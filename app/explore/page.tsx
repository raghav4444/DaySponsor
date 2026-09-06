'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MapPin, Users, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase, type Day, type Slot, type Profile, type CreatorProfile } from '@/lib/supabase';
import { categories } from '@/lib/data';
import { cn } from '@/lib/utils';

type DayWithDetails = Day & {
  profiles: Profile;
  creator_profiles: CreatorProfile | null;
  sponsorship_slots: Slot[];
};

export default function ExplorePage() {
  const [days, setDays] = useState<DayWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'price_low' | 'price_high'>('date');

  useEffect(() => {
    loadDays();
  }, []);

  const loadDays = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('days')
      .select(`
        *,
        profiles!days_creator_id_fkey(*),
        creator_profiles!inner(profile_id:profile_id, *)
      `)
      .in('status', ['live', 'in_progress'])
      .order('day_date', { ascending: true });

    if (error) {
      console.error('Error loading days:', error);
      setLoading(false);
      return;
    }

    const dayIds = (data || []).map((d) => d.id);
    if (dayIds.length === 0) {
      setDays([]);
      setLoading(false);
      return;
    }

    const { data: slotsData } = await supabase
      .from('sponsorship_slots')
      .select('*')
      .in('day_id', dayIds)
      .order('position', { ascending: true });

    const slotsByDay = (slotsData || []).reduce<Record<string, Slot[]>>((acc, slot) => {
      const s = slot as Slot;
      if (!acc[s.day_id]) acc[s.day_id] = [];
      acc[s.day_id].push(s);
      return acc;
    }, {});

    const combined = (data || []).map((d) => {
      const day = d as unknown as Day & { profiles: Profile; creator_profiles: CreatorProfile };
      return {
        ...day,
        creator_profiles: day.creator_profiles,
        sponsorship_slots: slotsByDay[day.id] || [],
      };
    }) as DayWithDetails[];

    setDays(combined);
    setLoading(false);
  };

  const filtered = days.filter((day) => {
    const matchesSearch =
      !search ||
      day.title.toLowerCase().includes(search.toLowerCase()) ||
      day.profiles?.name?.toLowerCase().includes(search.toLowerCase()) ||
      day.profiles?.username?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || day.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'price_low') {
      const aMin = Math.min(...(a.sponsorship_slots?.map((s) => s.price) || [0]));
      const bMin = Math.min(...(b.sponsorship_slots?.map((s) => s.price) || [0]));
      return aMin - bMin;
    }
    if (sortBy === 'price_high') {
      const aMax = Math.max(...(a.sponsorship_slots?.map((s) => s.price) || [0]));
      const bMax = Math.max(...(b.sponsorship_slots?.map((s) => s.price) || [0]));
      return bMax - aMax;
    }
    return new Date(a.day_date).getTime() - new Date(b.day_date).getTime();
  });

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight">
            Explore <span className="font-display italic">days</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            Find a creator whose day fits your product. Pick a slot. Sponsor them.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by creator, day title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="date">Sort by date</option>
              <option value="price_low">Price: low to high</option>
              <option value="price_high">Price: high to low</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setSelectedCategory('all')}
            className={cn(
              'px-4 py-2 text-sm rounded-full border transition-all',
              selectedCategory === 'all'
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card hover:bg-secondary'
            )}
          >
            All categories
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                'px-4 py-2 text-sm rounded-full border transition-all',
                selectedCategory === cat
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card hover:bg-secondary'
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-6 animate-pulse">
                <div className="h-32 bg-muted rounded-xl mb-4" />
                <div className="h-4 bg-muted rounded w-1/2 mb-2" />
                <div className="h-3 bg-muted rounded w-1/3 mb-4" />
                <div className="h-8 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-lg font-medium text-muted-foreground">No days found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try adjusting your filters or check back soon — new creators join every day.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sorted.map((day) => (
              <DayCard key={day.id} day={day} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DayCard({ day }: { day: DayWithDetails }) {
  const tierIcons: Record<string, string> = {
    Primary: '🥇',
    Featured: '🥈',
    Supporting: '🥉',
  };

  const availableSlots = day.sponsorship_slots?.filter((s) => s.is_available) || [];
  const takenSlots = day.sponsorship_slots?.filter((s) => !s.is_available) || [];
  const totalSlots = day.sponsorship_slots?.length || 0;

  const dateStr = new Date(day.day_date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <Link href={`/days/${day.id}`} className="group">
      <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-1">
        <div className="relative h-32 bg-gradient-to-br from-secondary to-secondary/50 overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: 'linear-gradient(135deg, hsl(var(--accent) / 0.3), transparent)' }}
          />
          <div className="absolute top-3 right-3 flex gap-2">
            <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
              {day.category}
            </Badge>
          </div>
          <div className="absolute bottom-3 left-4">
            <p className="text-xs font-medium text-muted-foreground">{dateStr}</p>
            <p className="font-semibold text-sm">{day.location}</p>
          </div>
        </div>

        <div className="p-5">
          <p className="font-semibold text-lg leading-tight">{day.title}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            by @{day.profiles?.username || day.profiles?.name}
          </p>

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            {day.creator_profiles && (
              <>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {day.creator_profiles.followers || 'N/A'}
                </span>
                <span>{day.creator_profiles.occupation}</span>
              </>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <div className="space-y-1.5">
              {day.sponsorship_slots?.map((slot) => (
                <div
                  key={slot.id}
                  className={cn(
                    'flex items-center justify-between text-sm py-1.5 px-2 rounded-lg',
                    slot.is_available ? '' : 'opacity-50 bg-muted/30'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{tierIcons[slot.tier]}</span>
                    <span className="font-medium">{slot.tier}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">€{slot.price}</span>
                    <span className={cn('text-xs', slot.is_available ? 'text-accent' : 'text-muted-foreground')}>
                      {slot.is_available ? 'Open' : 'Taken'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <Button className="w-full rounded-full" size="sm" variant={availableSlots.length === 0 ? 'secondary' : 'default'}>
              {availableSlots.length === 0
                ? 'Fully sponsored'
                : `Sponsor · ${availableSlots.length} of ${totalSlots} open`}
            </Button>
          </div>
        </div>
      </div>
    </Link>
  );
}
