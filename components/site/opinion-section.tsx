import { ArrowUpRight, Check, Eye, MessageSquareText, ShieldCheck } from 'lucide-react';

export function OpinionSection() {
  return (
    <section aria-labelledby="opinion-heading" className="border-y border-border/50 bg-secondary/20 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col justify-between gap-5 lg:mb-12 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              <span>Editorial independence</span>
            </div>
            <h2 id="opinion-heading" className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Sponsorship doesn&apos;t buy <span className="font-display font-normal italic">an opinion.</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground lg:pb-1">
            Brands sponsor access to a real experience. Creators keep the right to say what they actually think.
          </p>
        </div>

        <div className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-[0.8fr_1.2fr]">
          <div className="flex flex-col justify-between bg-foreground p-6 text-background sm:p-8 lg:p-10">
            <div>
              <div className="mb-10 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <MessageSquareText aria-hidden="true" className="h-5 w-5" />
              </div>
              <p className="max-w-sm text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                Real feedback is the product.
              </p>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-background/65">
                A useful experience includes what worked, what did not, and who it was right for.
              </p>
            </div>
            <div className="mt-12 flex items-center gap-2 text-xs font-medium text-background/65">
              <span className="h-2 w-2 rounded-full bg-accent" />
              No scripted verdicts
            </div>
          </div>

          <dl className="divide-y divide-border">
            <OpinionPrinciple
              icon={MessageSquareText}
              title="The creator keeps their own voice"
              description="The opinion should reflect what the creator genuinely experienced, not what a brand would like them to say."
            />
            <OpinionPrinciple
              icon={Eye}
              title="The relationship stays visible"
              description="Sponsored content is clearly disclosed, so the audience understands the context behind the experience."
            />
            <OpinionPrinciple
              icon={Check}
              title="The activity sets the expectation"
              description="The day and slot define what the brand is sponsoring. Documentation follows the actual use, not a predetermined verdict."
            />
          </dl>
        </div>
      </div>
    </section>
  );
}

function OpinionPrinciple({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof MessageSquareText;
  title: string;
  description: string;
}) {
  return (
    <div className="group flex gap-4 p-6 transition-colors hover:bg-secondary/50 sm:p-8">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent transition-transform group-hover:scale-105">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <dt className="flex items-center justify-between gap-3 font-semibold">
          <span>{title}</span>
          <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </dt>
        <dd className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</dd>
      </div>
    </div>
  );
}
