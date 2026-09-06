import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { categories } from '@/lib/data';

export function FinalCTA() {
  return (
    <section id="cta" className="py-32 relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full opacity-10 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(158 64% 42%), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground text-background">
            <Sparkles className="h-6 w-6" />
          </div>
        </div>

        <h2 className="text-balance text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05]">
          What will you
          <br />
          <span className="font-display italic font-normal text-accent">
            sponsor today?
          </span>
        </h2>

        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Join 127 sponsored days and €18,420 paid to creators.
          Your day is worth more than a banner.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button size="lg" className="rounded-full h-12 px-8 text-base group" asChild>
            <Link href="#explore">
              Explore creators
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="rounded-full h-12 px-8 text-base" asChild>
            <Link href="#creators">Create My Day</Link>
          </Button>
        </div>

        <div className="mt-16">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Explore by category
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {categories.map((cat) => (
              <Link
                key={cat}
                href="#explore"
                className="px-4 py-2 text-sm rounded-full border border-border bg-card hover:bg-secondary hover:border-foreground/20 transition-all"
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
