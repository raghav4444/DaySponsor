import { Calendar, Layers, Package, Camera, MessageSquare } from 'lucide-react';

const steps = [
  {
    icon: Calendar,
    title: 'A creator publishes a day',
    description: 'The activity comes first: what they plan to do, when and where it happens, and how a product could fit.',
    detail: 'Activity, date and location',
  },
  {
    icon: Layers,
    title: 'A brand chooses a relevant slot',
    description: 'The brand reads the day and compares the available tiers, prices and descriptions before choosing a fit.',
    detail: 'A defined sponsorship slot',
  },
  {
    icon: Package,
    title: 'The product becomes part of the day',
    description: 'The creator uses the product during the real activity, noticing where it helps and where it falls short.',
    detail: 'Use in a real context',
  },
  {
    icon: Camera,
    title: 'The experience is documented',
    description: 'Photos, notes or social content can show what happened, guided by the deliverables described in the slot.',
    detail: 'Evidence of the experience',
  },
  {
    icon: MessageSquare,
    title: 'The creator shares an honest review',
    description: 'A rating, pros, cons and whether they would use it again give the brand feedback beyond a mention.',
    detail: 'Feedback, not a script',
  },
];

export function SponsoredDaySection() {
  return (
    <section aria-labelledby="sponsored-day-heading" className="border-t border-border/50 py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-9 max-w-2xl text-center sm:mb-12">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Inside the experience</p>
          <h2 id="sponsored-day-heading" className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            A sponsored day, <span className="font-display italic font-normal">start to finish.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">From the plan to the final opinion, the activity is the thread that connects it all.</p>
        </div>

        <ol className="grid gap-0 lg:grid-cols-5 lg:gap-6" aria-label="The five stages of a sponsored day">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className={`group relative border-l border-border pl-7 pr-2 sm:pl-8 lg:border-l-0 lg:border-t lg:pl-0 lg:pr-0 lg:pt-6 ${index < steps.length - 1 ? 'pb-8 lg:pb-0' : 'pb-1'}`}
            >
              <span aria-hidden="true" className="absolute -left-1 top-0 h-2 w-2 rounded-full bg-accent ring-4 ring-background transition-transform group-hover:scale-125 lg:left-0 lg:-top-1" />
              <div className="mb-3 flex items-center gap-3">
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <step.icon aria-hidden="true" className="h-4 w-4" />
                </span>
              </div>
              <h3 className="max-w-sm text-balance text-lg font-semibold leading-tight">{step.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{step.description}</p>
              <p className="mt-4 text-xs font-semibold text-foreground/70">{step.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
