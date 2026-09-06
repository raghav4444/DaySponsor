import { Calendar, Clock, Camera, Star, CheckCircle2 } from 'lucide-react';

export function ExperienceSection() {
  return (
    <section className="py-20 bg-secondary/20 border-y border-border/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <p className="text-sm font-medium text-accent mb-3">The experience</p>
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            Before. During.
            <span className="font-display italic font-normal"> After.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Every sponsorship is a journey — from the moment a brand picks a slot
            to the honest review that follows.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <PhaseCard
            phase="Before"
            icon={Calendar}
            color="text-blue-500"
            bgColor="bg-blue-500/10"
            items={[
              'Creator publishes their day with 3 open slots',
              'Brand discovers the creator and picks a tier',
              'Payment is processed securely through Stripe',
              'Brand ships the product to the creator',
            ]}
          />
          <PhaseCard
            phase="During"
            icon={Clock}
            color="text-accent"
            bgColor="bg-accent/10"
            items={[
              'Creator uses the product as part of their real day',
              'Photos and social mentions are captured live',
              'Audience sees authentic, in-the-moment usage',
              'Deliverables are uploaded as they happen',
            ]}
            highlighted
          />
          <PhaseCard
            phase="After"
            icon={Star}
            color="text-amber-500"
            bgColor="bg-amber-500/10"
            items={[
              'Creator writes an honest review — good or bad',
              'Rating, pros, cons, and &ldquo;would I buy it?&rdquo; published',
              'Brand receives documented, authentic feedback',
              'Creator gets paid. Both sides win.',
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function PhaseCard({
  phase,
  icon: Icon,
  color,
  bgColor,
  items,
  highlighted,
}: {
  phase: string;
  icon: typeof Calendar;
  color: string;
  bgColor: string;
  items: string[];
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 transition-all hover:shadow-lg ${
        highlighted
          ? 'border-foreground/20 bg-card shadow-md md:-translate-y-2'
          : 'border-border bg-card/60'
      }`}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bgColor} mb-5`}>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <h3 className="text-xl font-semibold mb-4">{phase}</h3>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <CheckCircle2 className={`h-4 w-4 ${color} shrink-0 mt-0.5`} />
            <span dangerouslySetInnerHTML={{ __html: item }} />
          </li>
        ))}
      </ul>
      {highlighted && (
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Camera className="h-3.5 w-3.5" />
            <span>Live documentation, not staged ads</span>
          </div>
        </div>
      )}
    </div>
  );
}
