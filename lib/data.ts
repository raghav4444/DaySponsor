import {
  supabase,
  type CreatorProfile,
  type Day,
  type Profile,
  type Review,
  type Slot,
  type Sponsorship,
} from '@/lib/supabase';

export const categories = [
  'Developer', 'AI', 'Design', 'Travel', 'Fitness', 'Food', 'Gaming', 'Startup', 'Student', 'Tech',
];

export type MarketplaceStats = {
  paidToCreators: number;
  sponsoredDays: number;
  brandsParticipating: number;
  productsTested: number;
  totalSponsorships: number;
  averageInvestment: number;
  averageCreatorPayout: number;
};

export type MarketplaceStatsResult = {
  stats: MarketplaceStats | null;
  unavailable: boolean;
};

export type LiveActivityItem = {
  id: string;
  brand: string;
  brandHref: string | null;
  creator: string;
  creatorHref: string | null;
  dayTitle: string;
  dayHref: string;
  dayType: string;
  amount: number;
  time: string;
};

export type FeaturedCreator = {
  id: string;
  username: string;
  name: string;
  occupation: string | null;
  location: string | null;
  country_code: string;
  followers: string;
  impressions: string | null;
  bio: string | null;
  avatar: string | null;
  audience_description: string | null;
  category: string;
  day: Pick<Day, 'id' | 'title' | 'day_date' | 'status'>;
  slots: Slot[];
};

type SponsorshipStatsRow = Pick<
  Sponsorship,
  'id' | 'slot_id' | 'brand_id' | 'amount' | 'creator_amount' | 'status'
>;

type ActivitySponsorship = Sponsorship & {
  brand: Pick<Profile, 'name' | 'username'> | null;
  creator: Pick<Profile, 'name' | 'username'> | null;
};

type ActivitySlot = Pick<Slot, 'id' | 'day_id'>;

type ActivityDay = Pick<Day, 'id' | 'title' | 'category' | 'day_date'>;

const paidSponsorshipStatuses = new Set([
  'paid',
  'day_completed',
  'review_pending',
  'completed',
]);

export function slugifyDayTitle(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function loadMarketplaceStats(): Promise<MarketplaceStatsResult> {
  const [sponsorshipsResult, slotsResult, reviewsResult] = await Promise.all([
    supabase.from('sponsorships').select('id, slot_id, brand_id, creator_amount, status'),
    supabase.from('sponsorship_slots').select('id, day_id'),
    supabase.from('reviews').select('id, published_at'),
  ]);

  if (sponsorshipsResult.error || slotsResult.error || reviewsResult.error) {
    return { stats: null, unavailable: true };
  }

  const sponsorships = (sponsorshipsResult.data || []) as SponsorshipStatsRow[];
  const paidSponsorships = sponsorships.filter((sponsorship) =>
    paidSponsorshipStatuses.has(sponsorship.status),
  );
  const sponsoredSlotIds = new Set(paidSponsorships.map((sponsorship) => sponsorship.slot_id));
  const slots = (slotsResult.data || []) as ActivitySlot[];
  const reviews = (reviewsResult.data || []);

  const totalInvestment = sponsorships.reduce((total, sponsorship) => total + sponsorship.amount, 0);
  const totalCreatorPayout = paidSponsorships.reduce(
    (total, sponsorship) => total + sponsorship.creator_amount,
    0,
  );

  return {
    unavailable: false,
    stats: {
      paidToCreators: totalCreatorPayout,
      sponsoredDays: new Set(
        slots.filter((slot) => sponsoredSlotIds.has(slot.id)).map((slot) => slot.day_id),
      ).size,
      brandsParticipating: new Set(paidSponsorships.map((sponsorship) => sponsorship.brand_id)).size,
      productsTested: reviews.filter((review) => review.published_at).length,
      totalSponsorships: sponsorships.length,
      averageInvestment: sponsorships.length
        ? Math.round(totalInvestment / sponsorships.length)
        : 0,
      averageCreatorPayout: paidSponsorships.length
        ? Math.round(totalCreatorPayout / paidSponsorships.length)
        : 0,
    },
  };
}

export async function loadLiveActivity() {
  const { data: sponsorships, error } = await supabase
    .from('sponsorships')
    .select(`
      id,
      amount,
      status,
      created_at,
      slot_id,
      brand_id,
      creator_id,
      brand:profiles!sponsorships_brand_id_fkey(name, username),
      creator:profiles!sponsorships_creator_id_fkey(name, username)
    `)
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) {
    return { items: [] as LiveActivityItem[], unavailable: true };
  }

  const visibleSponsorships = (sponsorships || []).filter(
    (sponsorship) => !['cancelled', 'refunded'].includes(sponsorship.status),
  ) as unknown as ActivitySponsorship[];

  if (visibleSponsorships.length === 0) {
    return { items: [] as LiveActivityItem[], unavailable: false };
  }

  const slotIds = visibleSponsorships.map((sponsorship) => sponsorship.slot_id);
  const [slotsResult, reviewsResult] = await Promise.all([
    supabase.from('sponsorship_slots').select('id, day_id').in('id', slotIds),
    supabase.from('reviews').select('sponsorship_id').in('sponsorship_id', visibleSponsorships.map((sponsorship) => sponsorship.id)),
  ]);

  if (slotsResult.error || reviewsResult.error) {
    return { items: [] as LiveActivityItem[], unavailable: true };
  }

  const daysResult = await supabase
    .from('days')
    .select('id, title, category, day_date')
    .in(
      'id',
      Array.from(new Set((slotsResult.data || []).map((slot) => slot.day_id))),
    );

  if (daysResult.error) {
    return { items: [] as LiveActivityItem[], unavailable: true };
  }

  const slotsByDay = new Map<string, ActivitySlot[]>();
  for (const slot of (slotsResult.data || [])) {
    const existing = slotsByDay.get(slot.day_id) || [];
    existing.push(slot);
    slotsByDay.set(slot.day_id, existing);
  }

  const daysById = new Map((daysResult.data || []).map((day) => [day.id, day]));
  const reviewedSponsorships = new Set(
    (reviewsResult.data || []).map((review) => review.sponsorship_id),
  );

  const items = visibleSponsorships
    .map((sponsorship) => {
      const slot = (slotsResult.data || []).find((candidate) => candidate.id === sponsorship.slot_id);
      const day = slot ? daysById.get(slot.day_id) : null;
      if (!day) return null;

      const brandName = sponsorship.brand?.name || 'A brand';
      const creatorName = sponsorship.creator?.username
        ? `@${sponsorship.creator.username}`
        : sponsorship.creator?.name || 'A creator';
      const brandHref = sponsorship.brand?.username ? `/creators/${encodeURIComponent(sponsorship.brand.username)}` : null;
      const creatorHref = sponsorship.creator?.username
        ? `/creators/${encodeURIComponent(sponsorship.creator.username)}`
        : null;

      return {
        id: sponsorship.id,
        brand: brandName,
        brandHref,
        creator: creatorName,
        creatorHref,
        dayTitle: day.title,
        dayHref: `/days/${slugifyDayTitle(day.title)}`,
        dayType: day.category,
        amount: sponsorship.amount,
        time: formatRelativeTime(sponsorship.created_at),
      } satisfies LiveActivityItem;
    })
    .filter((item): item is LiveActivityItem => Boolean(item));

  return {
    items: items.slice(0, 8),
    unavailable: false,
    hasReviews: reviewedSponsorships.size > 0,
  };
}

export async function loadFeaturedCreators() {
  const { data: daysData, error: daysError } = await supabase
    .from('days')
    .select(`
      *,
      profiles!days_creator_id_fkey(*),
      creator_profiles!inner(profile_id:profile_id, *)
    `)
    .in('status', ['live', 'in_progress', 'full'])
    .order('day_date', { ascending: true })
    .limit(8);

  if (daysError) {
    return { creators: [] as FeaturedCreator[], unavailable: true };
  }

  if (!daysData?.length) {
    return { creators: [] as FeaturedCreator[], unavailable: false };
  }

  const dayIds = daysData.map((day) => day.id);
  const { data: slotsData, error: slotsError } = await supabase
    .from('sponsorship_slots')
    .select('*')
    .in('day_id', dayIds)
    .order('position', { ascending: true });

  if (slotsError) {
    return { creators: [] as FeaturedCreator[], unavailable: true };
  }

  const slotsByDay = (slotsData || []).reduce<Record<string, Slot[]>>((acc, slot) => {
    const normalizedSlot = slot as Slot;
    if (!acc[normalizedSlot.day_id]) acc[normalizedSlot.day_id] = [];
    acc[normalizedSlot.day_id].push(normalizedSlot);
    return acc;
  }, {});

  const creators = daysData.map((row) => {
    const day = row as unknown as Day & {
      profiles: Profile;
      creator_profiles: CreatorProfile;
    };
    const profile = day.profiles;
    const creatorProfile = day.creator_profiles;

    return {
      id: day.id,
      username: profile.username || profile.name.toLowerCase().replace(/\s+/g, '-'),
      name: profile.name,
      occupation: creatorProfile.occupation,
      location: creatorProfile.location,
      country_code: creatorProfile.country_code,
      followers: creatorProfile.followers,
      impressions: creatorProfile.impressions,
      bio: profile.bio,
      avatar: profile.avatar_url,
      audience_description: creatorProfile.audience_description,
      category: day.category,
      day: {
        id: day.id,
        title: day.title,
        day_date: day.day_date,
        status: day.status,
      },
      slots: slotsByDay[day.id] || [],
    } satisfies FeaturedCreator;
  });

  return { creators, unavailable: false };
}

function formatRelativeTime(value: string) {
  const differenceInSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );

  if (differenceInSeconds < 60) return 'just now';
  if (differenceInSeconds < 3600) {
    const minutes = Math.floor(differenceInSeconds / 60);
    return `${minutes} min ago`;
  }
  if (differenceInSeconds < 86400) {
    const hours = Math.floor(differenceInSeconds / 3600);
    return `${hours} hr ago`;
  }

  const days = Math.floor(differenceInSeconds / 86400);
  return `${days} d ago`;
}
