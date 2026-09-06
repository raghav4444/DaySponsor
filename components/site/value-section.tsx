import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const audiences = [
  {
    label: 'For creators',
    title: 'Make room for relevant collaborations.',
    benefits: [
      'Turn real upcoming activities into sponsorship opportunities.',
      'Give relevant brands a way to discover your day.',
      'Set your own slot prices and earn through sponsorships.',
      'Keep product use grounded in what you actually do.',
      'Build a record of collaborations through campaigns and reviews.',
    ],
  },
  {
    label: 'For brands',
    title: 'Start with the setting, not just the audience.',
    benefits: [
      'Find creators around activities relevant to your product.',
      'Put your product into a real context of use.',
      'See the experience through the content a creator documents.',
      'Receive genuine feedback, including strengths and limitations.',
      'Sponsor a specific activity rather than only generic exposure.',
    ],
  },
];

export function ValueSection() {
  return (
    <section aria-labelledby="value-heading" className="py-16 sm:py-24 bg-secondary/20 border-y border-border/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Value for both sides</p>
          <h2 id="value-heading" className="text-balance text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
            Different goals. <span className="font-display italic font-normal">A shared experience.</span>
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {audiences.map((audience) => (
            <Card key={audience.label} className="rounded-2xl shadow-none">
              <CardHeader>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{audience.label}</p>
                <CardTitle className="text-balance text-xl leading-tight">{audience.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-4">
                  {audience.benefits.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-3 text-sm text-muted-foreground leading-relaxed">
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-accent mt-1" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
