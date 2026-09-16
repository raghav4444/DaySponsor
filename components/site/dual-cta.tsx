import Link from 'next/link';
import { ArrowRight, DollarSign, Target, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DualCTA() {
  return (
    <>
      <section id="creators" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="group relative rounded-3xl border border-border bg-card p-10 sm:p-14 overflow-hidden transition-all hover:shadow-xl">
              <div
                className="absolute -top-20 -right-20 w-60 h-60 rounded-full opacity-10 blur-3xl"
                style={{ background: 'radial-gradient(circle, hsl(158 64% 42%), transparent 70%)' }}
              />
              <div className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 mb-6">
                  <DollarSign className="h-5 w-5 text-accent" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                  Earn from your
                  <br />
                  <span className="font-display italic font-normal">everyday life.</span>
                </h2>
                <p className="mt-4 text-muted-foreground leading-relaxed max-w-md">
                  Turn the things you already do into sponsorship opportunities.
                  Building, traveling, cooking, coding — your day is valuable.
                </p>
                <div className="mt-6 space-y-2 text-sm">
                  <Stat label="Average payout per day" value="€270" />
                  <Stat label="Platform fee" value="10%" />
                  <Stat label="Payout time" value="2-3 days" />
                </div>
                <Button className="mt-8 rounded-full group/btn" size="lg" asChild>
                  <Link href="#cta">
                    Become a Creator
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                  </Link>
                </Button>
              </div>
            </div>

            <div id="brands" className="group relative rounded-3xl border border-border bg-foreground text-background p-10 sm:p-14 overflow-hidden transition-all hover:shadow-xl">
              <div
                className="absolute -top-20 -right-20 w-60 h-60 rounded-full opacity-20 blur-3xl"
                style={{ background: 'radial-gradient(circle, hsl(158 64% 42%), transparent 70%)' }}
              />
              <div className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-background/10 mb-6">
                  <Target className="h-5 w-5 text-background" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                  Stop buying impressions.
                  <br />
                  <span className="font-display italic font-normal text-accent">
                    Start buying experiences.
                  </span>
                </h2>
                <p className="mt-4 text-background/70 leading-relaxed max-w-md">
                  Put your product in the hands of people who actually use it.
                  Get real-world usage, authentic storytelling, and honest feedback.
                </p>
                <div className="mt-6 space-y-2 text-sm">
                  <DarkStat label="Average reach per sponsorship" value="~15,000" />
                  <DarkStat label="Average investment" value="€179" />
                  <DarkStat label="Deliverables included" value="5+" />
                </div>
                <Button
                  variant="secondary"
                  className="mt-8 rounded-full bg-background text-foreground hover:bg-background/90 group/btn"
                  size="lg"
                  asChild
                >
                  <Link href="#explore">
                    Find a Creator
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function DarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-background/10 last:border-0">
      <span className="text-background/60">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
