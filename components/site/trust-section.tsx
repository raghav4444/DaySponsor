import { ShieldCheck, Star, Eye } from 'lucide-react';

export function TrustSection() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-border bg-card overflow-hidden">
          <div className="grid md:grid-cols-2">
            <div className="p-10 sm:p-14">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium mb-6">
                <ShieldCheck className="h-3.5 w-3.5" />
                Our trust principle
              </div>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
                Sponsored placement
                <br />
                <span className="font-display italic font-normal">
                  never means
                </span>
                <br />
                a guaranteed review.
              </h2>
              <p className="mt-6 text-muted-foreground leading-relaxed">
                Brands pay for access and exposure — not positive opinions.
                Creators control the review. That&apos;s what makes this work.
                Every review is labeled. Every opinion is real.
              </p>
            </div>

            <div className="bg-secondary/40 p-10 sm:p-14 flex flex-col justify-center gap-6">
              <ReviewPreview
                brand="Notion"
                rating={4}
                wouldRecommend
                pros={['Fast setup', 'Great templates']}
                cons={['Pricey for solo use']}
              />
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-accent fill-accent" />
                  <span className="font-medium">Honest ratings</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Eye className="h-4 w-4 text-accent" />
                  <span className="font-medium">Fully transparent</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewPreview({
  brand,
  rating,
  wouldRecommend,
  pros,
  cons,
}: {
  brand: string;
  rating: number;
  wouldRecommend: boolean;
  pros: string[];
  cons: string[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background text-xs font-bold">
            {brand.slice(0, 2).toUpperCase()}
          </div>
          <span className="font-semibold text-sm">{brand}</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
          Sponsored experience
        </span>
      </div>
      <div className="flex gap-0.5 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={`h-4 w-4 ${
              i < rating ? 'text-amber-400 fill-amber-400' : 'text-border'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <p className="font-semibold text-accent mb-1.5">What I loved</p>
          {pros.map((p) => (
            <p key={p} className="text-muted-foreground">+ {p}</p>
          ))}
        </div>
        <div>
          <p className="font-semibold text-destructive mb-1.5">What I didn&apos;t</p>
          {cons.map((c) => (
            <p key={c} className="text-muted-foreground">- {c}</p>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Would I buy it myself?{' '}
          <span className="font-semibold text-accent">
            {wouldRecommend ? 'Yes' : 'No'}
          </span>
        </p>
      </div>
    </div>
  );
}
