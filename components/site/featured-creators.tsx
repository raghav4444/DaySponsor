'use client';

import { useRef } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { creators, type Creator } from '@/lib/data';
import { cn } from '@/lib/utils';

export function FeaturedCreators() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = 340;
    scrollRef.current.scrollBy({
      left: dir === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  return (
    <section id="explore" className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-12">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
              <p className="text-sm font-medium text-accent">Live now</p>
            </div>
            <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">
              Sponsorships happening
              <br />
              <span className="font-display italic font-normal">right now</span>
            </h2>
          </div>
          <div className="hidden sm:flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={() => scroll('left')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={() => scroll('right')}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex gap-5 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-none"
          style={{ scrollbarWidth: 'none' }}
        >
          {creators.map((creator) => (
            <CreatorCard key={creator.username} creator={creator} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CreatorCard({ creator }: { creator: Creator }) {
  const tierIcons: Record<string, string> = {
    Primary: '🥇',
    Featured: '🥈',
    Supporting: '🥉',
  };

  return (
    <div className="snap-start shrink-0 w-[340px] group cursor-pointer">
      <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-1">
        <div className="relative h-32 bg-gradient-to-br from-secondary to-secondary/50 overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: `linear-gradient(135deg, hsl(var(--accent) / 0.3), transparent)`,
            }}
          />
          <div className="absolute top-3 right-3">
            <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
              {creator.category}
            </Badge>
          </div>
        </div>

        <div className="px-5 pb-5 -mt-10">
          <div className="h-20 w-20 rounded-full border-4 border-card bg-muted overflow-hidden mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={creator.avatar}
              alt={creator.name}
              className="h-full w-full object-cover"
            />
          </div>

          <p className="font-semibold text-lg leading-tight">{creator.username}</p>
          <p className="text-sm text-muted-foreground">{creator.occupation}</p>

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {creator.location} {creator.flag}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {creator.followers}
            </span>
          </div>

          <p className="mt-3 text-sm italic text-muted-foreground line-clamp-1">
            &ldquo;{creator.bio}&rdquo;
          </p>

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {creator.dayDate} · {creator.dayTitle}
            </p>
            <div className="space-y-1.5">
              {creator.slots.map((slot) => (
                <div
                  key={slot.tier}
                  className={cn(
                    'flex items-center justify-between text-sm py-1.5 px-2 rounded-lg transition-colors',
                    slot.taken
                      ? 'bg-muted/40 opacity-60'
                      : 'hover:bg-secondary group-hover:bg-secondary/50'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{tierIcons[slot.tier]}</span>
                    <span className="font-medium">{slot.tier}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">€{slot.price}</span>
                    <span
                      className={cn(
                        'text-xs',
                        slot.taken ? 'text-muted-foreground' : 'text-accent font-medium'
                      )}
                    >
                      {slot.taken ? 'Taken' : 'Open'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <Button className="w-full rounded-full" size="sm" variant={creator.slotsTaken === creator.slotsTotal ? 'secondary' : 'default'}>
              {creator.slotsTaken === creator.slotsTotal
                ? 'Fully sponsored'
                : `Sponsor a slot · ${creator.slotsTotal - creator.slotsTaken} left`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
