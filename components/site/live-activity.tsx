import { activityFeed } from '@/lib/data';

export function LiveActivity() {
  const doubled = [...activityFeed, ...activityFeed];

  return (
    <section className="py-20 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mb-12">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
            <p className="text-sm font-medium text-accent">Today&apos;s sponsors</p>
          </div>
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            The marketplace is
            <span className="font-display italic font-normal"> alive.</span>
          </h2>
        </div>
      </div>

      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />

        <div className="flex gap-4 animate-scroll-x w-max">
          {doubled.map((item, i) => (
            <ActivityCard key={i} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ActivityCard({
  brand,
  brandColor,
  creator,
  dayType,
  amount,
  time,
}: {
  brand: string;
  brandColor: string;
  creator: string;
  dayType: string;
  amount: number;
  time: string;
}) {
  return (
    <div className="shrink-0 w-80 rounded-xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${brandColor} text-white text-sm font-bold shrink-0`}>
          {brand.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {brand} sponsored {creator}&apos;s {dayType}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{time}</p>
        </div>
        <p className="font-semibold text-sm shrink-0">€{amount}</p>
      </div>
    </div>
  );
}
