import { Check, CircleHelp, Eye, ShieldCheck, X } from 'lucide-react';

export function TransparencySection() {
  return (
    <section aria-labelledby="transparency-heading" className="border-y border-border/50 bg-secondary/20 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col justify-between gap-6 lg:mb-12 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
              <ShieldCheck className="h-4 w-4" />
              <span>Trust &amp; transparency</span>
            </div>
            <h2 id="transparency-heading" className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              The sponsorship, <span className="font-display font-normal italic">clearly defined.</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground lg:pb-1">
            Every day has a clear scope, a clear price, and room for an honest opinion. No hidden expectations.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="grid md:grid-cols-2">
            <PolicyPanel
              icon={Check}
              eyebrow="Included"
              title="A real product experience"
              items={[
                'A defined creator activity and sponsorship slot.',
                'Product use during the creator\'s actual day.',
                'Documented deliverables and a published experience.',
              ]}
            />
            <PolicyPanel
              icon={X}
              eyebrow="Not included"
              title="A guaranteed positive review"
              items={[
                'Creators never promise a particular opinion.',
                'No script, talking points, or forced endorsement.',
                'Sponsorship disclosure stays visible to the audience.',
              ]}
              muted
            />
          </div>

          <div className="border-t border-border bg-secondary/30 px-6 py-5 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Eye className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">A transparent marketplace by design</p>
                  <p className="text-xs text-muted-foreground">Scope and availability are visible before checkout.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-accent" />
                Nothing hidden
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-10 grid gap-0 divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Principle
            icon={CircleHelp}
            title="Creator-defined tiers"
            description="Primary, Featured, and Supporting slots each spell out the product use and deliverables."
          />
          <Principle
            icon={Check}
            title="One price per slot"
            description="Compare price and scope for that day instead of assuming every tier is the same."
          />
          <Principle
            icon={Eye}
            title="Availability in context"
            description="Open means offered; taken means unavailable. Always check the date and slot together."
          />
        </dl>
      </div>
    </section>
  );
}

function PolicyPanel({
  icon: Icon,
  eyebrow,
  title,
  items,
  muted,
}: {
  icon: typeof Check;
  eyebrow: string;
  title: string;
  items: string[];
  muted?: boolean;
}) {
  return (
    <div className={`group p-6 sm:p-8 ${muted ? 'border-t border-border bg-secondary/20 md:border-l md:border-t-0' : ''}`}>
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <p className={`mb-2 text-xs font-semibold uppercase tracking-wider ${muted ? 'text-destructive' : 'text-accent'}`}>
            {eyebrow}
          </p>
          <h3 className="text-xl font-semibold leading-tight tracking-tight">{title}</h3>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${muted ? 'bg-destructive/10 text-destructive group-hover:scale-110 group-hover:bg-destructive/15' : 'bg-accent/10 text-accent'}`}>
          <Icon className={`h-4 w-4 ${muted ? 'transition-transform duration-200 group-hover:rotate-90' : ''}`} />
        </div>
      </div>
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
            <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${muted ? 'bg-destructive/10 text-destructive' : 'bg-accent/10 text-accent'}`}>
              <Icon className="h-3 w-3" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Principle({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Check;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 py-6 sm:px-6 first:sm:pl-0 last:sm:pr-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div>
        <dt className="text-sm font-semibold">{title}</dt>
        <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</dd>
      </div>
    </div>
  );
}
