'use client';

import { useEffect, useRef, useState } from 'react';
import { loadMarketplaceStats, type MarketplaceStats } from '@/lib/data';
import { gsap, ScrollTrigger, refreshScrollTriggers } from '@/hooks/use-gsap';

gsap.registerPlugin(ScrollTrigger);

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat('en-US');

export function StatsBar() {
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    loadMarketplaceStats().then((result) => {
      if (!mounted) return;
      setStats(result.stats);
      setUnavailable(result.unavailable);
      setLoading(false);
      // The section's height changes once real data lands, so trigger
      // positions computed against the loading skeleton are now stale.
      refreshScrollTriggers();
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const grid = gridRef.current;
    if (!grid) return;

    const ctx = gsap.context(() => {
      gsap.from(grid.children, {
        y: 18,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
        stagger: 0.08,
        scrollTrigger: {
          trigger: grid,
          start: 'top 85%',
          toggleActions: 'play none none reverse',
        },
      });
    }, grid);

    return () => ctx.revert();
  }, [loading]);

  return (
    <section className="relative py-12 border-y border-border/50 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4" aria-live="polite">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="animate-pulse">
                <div className="h-9 w-24 rounded bg-muted" />
                <div className="mt-3 h-4 w-32 rounded bg-muted" />
                <div className="mt-2 h-3 w-20 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : unavailable || !stats ? (
          <div className="text-center py-4" aria-live="polite">
            <p className="text-sm font-medium text-muted-foreground">Marketplace stats are temporarily unavailable.</p>
            <p className="text-xs text-muted-foreground mt-1">Live figures will appear when the database is reachable.</p>
          </div>
        ) : stats.paidToCreators === 0 && stats.sponsoredDays === 0 && stats.productsTested === 0 ? (
          <div className="text-center py-4" aria-live="polite">
            <p className="text-sm font-medium text-muted-foreground">The marketplace is just getting started.</p>
            <p className="text-xs text-muted-foreground mt-1">Real activity will appear here as sponsorships are published.</p>
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4">
            <Stat value={currency.format(stats.paidToCreators)} label="Paid to creators" sub="and growing" />
            <Stat value={integer.format(stats.sponsoredDays)} label="Sponsored days" sub="completed or in progress" />
            <Stat value={integer.format(stats.brandsParticipating)} label="Brands participating" sub="and counting" />
            <Stat value={integer.format(stats.productsTested)} label="Products tested" sub="honest reviews published" />
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div data-anim className="text-center lg:text-left lg:border-l lg:border-border/50 lg:pl-6 first:lg:border-l-0 first:lg:pl-0">
      <p className="text-3xl sm:text-4xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
