'use client';

import Link from 'next/link';
import { ArrowRight, Star, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HomeActionLink } from '@/components/site/home-action-link';
import { gsap, ScrollTrigger, useGsapSection } from '@/hooks/use-gsap';

gsap.registerPlugin(ScrollTrigger);

export function Hero() {
  const { ref, animate } = useGsapSection<HTMLElement>();

  animate(() => {
    const mm = gsap.matchMedia();
    const q = gsap.utils.selector(ref.current);

    // Entrance: badge -> headline -> subhead -> CTAs -> trust row -> mock card.
    const tl = gsap.timeline({
      delay: 0.15,
      defaults: { ease: 'power3.out' },
      onComplete: () => {
        // Never leave anything hidden if the timeline is killed mid-flight.
        gsap.set(q('[data-hero], [data-hero-card], [data-hero-slot]'), {
          clearProps: 'opacity,transform',
        });
      },
    });
    tl.from(q('[data-hero]'), {
      y: 30,
      opacity: 0,
      duration: 0.9,
      stagger: 0.12,
    })
      .from(
        q('[data-hero-card]'),
        {
          y: 60,
          opacity: 0,
          scale: 0.97,
          duration: 1.1,
          ease: 'power4.out',
        },
        '-=0.5',
      )
      .from(
        q('[data-hero-slot]'),
        {
          x: 26,
          opacity: 0,
          duration: 0.55,
          stagger: 0.11,
        },
        '-=0.4',
      );

    // Parallax on glow + card while the hero scrolls out of view.
    mm.add('(min-width: 768px)', () => {
      gsap.to(q('[data-hero-glow]'), {
        yPercent: 30,
        ease: 'none',
        scrollTrigger: {
          trigger: ref.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1.2,
        },
      });
      gsap.to(q('[data-hero-card]'), {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: {
          trigger: ref.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1.6,
        },
      });
    });
  });

  return (
    <section
      ref={ref}
      className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden"
    >
      <div data-hero-glow className="absolute inset-0 grid-bg opacity-50" />
      <div data-hero-glow className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
      <div
        data-hero-glow
        className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(158 64% 42%), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <div data-hero className="flex justify-center mb-6">
            <Badge
              variant="outline"
              className="px-4 py-1.5 text-xs font-medium gap-2 bg-background/50 backdrop-blur-sm"
            >
              <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
              127 days sponsored · €18,420 paid to creators
            </Badge>
          </div>

          <h1
            data-hero
            className="text-balance text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05]"
          >
            Let brands sponsor
            <br />
            <span className="font-display italic font-normal text-accent">
              your day.
            </span>
          </h1>

          <p
            data-hero
            className="mx-auto mt-6 max-w-2xl text-balance text-lg sm:text-xl text-muted-foreground leading-relaxed"
          >
            Use their product. Tell the truth. Get paid.
            <br className="hidden sm:block" />
            The marketplace where brands sponsor real creator experiences — not advertisements.
          </p>

          <div data-hero className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="rounded-full h-12 px-8 text-base group" asChild>
              <HomeActionLink>
                Create My Day
                <ArrowRight className="ml-4 w-4 transition-transform group-hover:translate-x-1" />
              </HomeActionLink>
            </Button>
            <Button size="lg" variant="outline" className="rounded-full h-12 px-8 text-base" asChild>
              <Link href="/explore">Find a Creator</Link>
            </Button>
          </div>

          <div
            data-hero
            className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
          >
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-accent" />
              <span>No guaranteed positive reviews</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Star className="h-4 w-4 text-accent fill-accent" />
              <span>Honest opinions, always</span>
            </div>
          </div>
        </div>

        <div data-hero-card className="mt-20">
          <div className="relative mx-auto max-w-5xl">
            <div className="absolute inset-0 bg-gradient-to-r from-accent/10 via-blue-500/10 to-accent/10 rounded-3xl blur-2xl" />
            <div className="relative rounded-2xl border border-border bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-400/80" />
                  <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
                  <div className="h-3 w-3 rounded-full bg-green-400/80" />
                </div>
                <div className="ml-2 text-xs text-muted-foreground font-medium">
                  daysponsor.app/raghvendra
                </div>
              </div>
              <div className="grid md:grid-cols-[1fr_1.2fr] gap-0">
                <div className="p-8 border-r border-border">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="h-16 w-16 rounded-full bg-gradient-to-br from-foreground to-foreground/60" />
                    <div>
                      <p className="font-semibold text-lg">@raghvendra</p>
                      <p className="text-sm text-muted-foreground">Software Developer</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Rotterdam 🇳🇱 · 4.2K followers</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6 italic">
                    &ldquo;Building an AI SaaS in public&rdquo;
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Sept 18</span>
                      <span className="text-foreground font-medium">Developer Day</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Expected reach</span>
                      <span className="font-medium">~12,000 people</span>
                    </div>
                  </div>
                </div>
                <div className="p-8 bg-secondary/30">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                    Available sponsorships
                  </p>
                  <div className="space-y-3">
                    <div data-hero-slot>
                      <SlotPreview tier="Primary" price={299} perks="Product used throughout the day · Social mentions · Full review" available />
                    </div>
                    <div data-hero-slot>
                      <SlotPreview tier="Featured" price={149} perks="Product usage · Social mention · Review" available={false} />
                    </div>
                    <div data-hero-slot>
                      <SlotPreview tier="Supporting" price={79} perks="Product usage · Mention · Short review" available />
                    </div>
                  </div>
                  <div className="mt-6 pt-4 border-t border-border">
                    <Button className="w-full rounded-full" size="sm">
                      Sponsor a slot
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SlotPreview({
  tier,
  price,
  perks,
  available,
}: {
  tier: string;
  price: number;
  perks: string;
  available: boolean;
}) {
  const tierIcons: Record<string, string> = { Primary: '🥇', Featured: '🥈', Supporting: '🥉' };
  return (
    <div
      className={`flex items-center justify-between rounded-xl border p-3 transition-all ${
        available
          ? 'border-border bg-card hover:border-foreground/20 hover:shadow-sm cursor-pointer'
          : 'border-border/50 bg-muted/30 opacity-60'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-lg">{tierIcons[tier]}</span>
        <div>
          <p className="text-sm font-semibold">
            {tier} Sponsor
          </p>
          <p className="text-xs text-muted-foreground">{perks}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-semibold">€{price}</p>
        <p className={`text-xs ${available ? 'text-accent' : 'text-muted-foreground'}`}>
          {available ? 'Available' : 'Taken'}
        </p>
      </div>
    </div>
  );
}
