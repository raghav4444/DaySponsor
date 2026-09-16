import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configurationError = new Error(
  'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Netlify.',
);

const unavailableResult = Promise.resolve({
  data: null,
  error: configurationError,
});

let unavailableQuery: Record<string, unknown>;

unavailableQuery = new Proxy({}, {
  get(_target, property) {
    if (property === 'then') {
      return unavailableResult.then.bind(unavailableResult);
    }

    return () => unavailableQuery;
  },
});

function createUnavailableClient() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: null },
        error: configurationError,
      }),
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe: () => {},
          },
        },
      }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: configurationError,
      }),
      signUp: async () => ({
        data: { user: null, session: null },
        error: configurationError,
      }),
      signOut: async () => ({ error: configurationError }),
    },
    from: () => unavailableQuery,
  } as unknown as SupabaseClient;
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : createUnavailableClient();

export type Profile = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  role: 'creator' | 'brand' | 'admin';
  bio: string | null;
  created_at: string;
};

export type CreatorProfile = {
  id: string;
  profile_id: string;
  occupation: string | null;
  location: string | null;
  country_code: string;
  followers: string;
  impressions: string;
  social_links: string[];
  audience_description: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  total_earned: number;
  days_sponsored: number;
  creator_rating: number;
};

export type Day = {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  day_date: string;
  location: string | null;
  category: string;
  expected_reach: string;
  status: 'draft' | 'live' | 'full' | 'in_progress' | 'completed' | 'cancelled';
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Slot = {
  id: string;
  day_id: string;
  tier: 'Primary' | 'Featured' | 'Supporting';
  price: number;
  position: number;
  description: string | null;
  is_available: boolean;
  created_at: string;
};

export type Sponsorship = {
  id: string;
  slot_id: string;
  brand_id: string;
  creator_id: string;
  amount: number;
  platform_fee: number;
  creator_amount: number;
  status: 'pending' | 'paid' | 'product_shipped' | 'product_received' | 'day_completed' | 'review_pending' | 'completed' | 'cancelled' | 'refunded';
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Review = {
  id: string;
  sponsorship_id: string;
  rating: number;
  title: string | null;
  content: string | null;
  pros: string[];
  cons: string[];
  would_recommend: boolean;
  video_url: string | null;
  video_platform: 'instagram' | 'tiktok' | 'youtube' | 'x' | 'other' | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Deliverable = {
  id: string;
  sponsorship_id: string;
  type: 'instagram' | 'tiktok' | 'youtube' | 'x_post' | 'photo' | 'video' | 'blog' | 'review';
  url: string | null;
  description: string | null;
  status: 'pending' | 'completed' | 'rejected';
  completed_at: string | null;
  created_at: string;
};
