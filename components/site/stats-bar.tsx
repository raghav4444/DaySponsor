import { marketplaceStats } from '@/lib/data';

export function StatsBar() {
  return (
    <section className="relative py-16 border-y border-border/50 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4">
          {marketplaceStats.map((stat, i) => (
            <div
              key={stat.label}
              className="text-center lg:text-left lg:border-l lg:border-border/50 lg:pl-6 first:lg:border-l-0 first:lg:pl-0"
            >
              <p className="text-3xl sm:text-4xl font-semibold tracking-tight">
                {stat.value}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {stat.label}
              </p>
              <p className="text-xs text-muted-foreground">{stat.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
