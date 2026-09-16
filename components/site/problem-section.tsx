import { ArrowRight, Calendar, Package } from 'lucide-react';

export function ProblemSection() {
  return (
    <section aria-labelledby="problem-heading" className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col justify-between gap-5 lg:mb-12 lg:flex-row lg:items-end">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">The problem</p>
            <h2 id="problem-heading" className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Two sides. <span className="font-display font-normal italic">One gap.</span>
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground lg:pb-1">
            An audience looking for relevant opportunities. A product looking for a real place in someone&apos;s day.
          </p>
        </div>

        <div className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-2">
          <ProblemPanel
            index="01"
            icon={Calendar}
            eyebrow="For creators"
            title="Good content doesn&apos;t always lead to the right opportunity."
            body="You can have an engaged audience and still struggle to find relevant, consistent brand opportunities. Traditional sponsorships often depend on pitching and fitting into a scripted campaign."
            outcome="Turn the activities you already plan into clear sponsorship opportunities."
          />
          <ProblemPanel
            index="02"
            icon={Package}
            eyebrow="For brands"
            title="The right creator is only part of the picture."
            body="A relevant audience matters, but so does the setting. Brands need to see how a product fits into real use, beyond a scripted promotional endorsement."
            outcome="Start with a defined creator activity and a relevant experience."
            muted
          />
        </div>

        <div className="mt-6 flex flex-col items-center justify-center gap-3 text-center sm:flex-row">
          <span className="text-sm text-muted-foreground">DaySponsor brings both sides together around</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-3 py-1.5 text-sm font-medium text-foreground">
            a real creator day
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
          </span>
        </div>
      </div>
    </section>
  );
}

function ProblemPanel({
  index,
  icon: Icon,
  eyebrow,
  title,
  body,
  outcome,
  muted,
}: {
  index: string;
  icon: typeof Calendar;
  eyebrow: string;
  title: string;
  body: string;
  outcome: string;
  muted?: boolean;
}) {
  return (
    <article className={`group flex min-h-[320px] flex-col p-6 transition-colors sm:p-8 lg:p-10 ${muted ? 'border-t border-border bg-secondary/20 md:border-l md:border-t-0' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent transition-transform duration-300 group-hover:scale-105">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </div>
        <span className="font-mono text-xs text-muted-foreground/60">{index}</span>
      </div>
      <div className="mt-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
        <h3 className="max-w-md text-balance text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{title}</h3>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <p className="mt-auto border-t border-border pt-5 text-sm font-medium leading-relaxed text-foreground">{outcome}</p>
    </article>
  );
}
