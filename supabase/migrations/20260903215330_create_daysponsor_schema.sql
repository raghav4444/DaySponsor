/*
# DaySponsor — Full Database Schema

## Overview
Creates the complete data model for the DaySponsor marketplace:
- profiles (extends Supabase auth.users with role, username, etc.)
- creator_profiles (bio, location, followers, social links)
- days (a creator's sponsored day with date, location, category)
- sponsorship_slots (3 tiers per day: Primary, Featured, Supporting)
- sponsorships (a brand purchasing a slot — payment, status, deliverables)
- reviews (creator's honest review of the sponsored product)
- deliverables (proof items: social posts, photos, videos)

## Security
- RLS enabled on every table
- Profiles: each user reads/writes own profile; public profiles are readable by all authenticated users
- Days & slots: publicly readable (marketplace browsing); only the owning creator can create/edit/delete
- Sponsorships: brand owner and slot's creator can read; only brand owner can insert
- Reviews: publicly readable; only the sponsoring creator can create/edit
- Deliverables: brand owner and creator can read; only creator can create/update

## Notes
1. profiles.user_id defaults to auth.uid() so inserts from the client work without passing user_id
2. All owner columns use DEFAULT auth.uid() where appropriate
3. Foreign keys cascade on delete for clean data management
*/

-- ============= PROFILES =============
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  username text UNIQUE,
  avatar_url text,
  role text NOT NULL DEFAULT 'creator' CHECK (role IN ('creator', 'brand', 'admin')),
  bio text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_public" ON profiles;
CREATE POLICY "profiles_select_own_or_public"
ON profiles FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR role = 'brand' OR role = 'creator');

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============= CREATOR PROFILES =============
CREATE TABLE IF NOT EXISTS creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  occupation text,
  location text,
  country_code text DEFAULT '',
  followers text DEFAULT '',
  impressions text DEFAULT '',
  social_links jsonb DEFAULT '[]'::jsonb,
  audience_description text,
  stripe_account_id text,
  stripe_onboarding_complete boolean DEFAULT false,
  total_earned numeric DEFAULT 0,
  days_sponsored integer DEFAULT 0,
  creator_rating numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE creator_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creator_profiles_select_all" ON creator_profiles;
CREATE POLICY "creator_profiles_select_all"
ON creator_profiles FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "creator_profiles_insert_own" ON creator_profiles;
CREATE POLICY "creator_profiles_insert_own"
ON creator_profiles FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = creator_profiles.profile_id AND profiles.user_id = auth.uid())
);

DROP POLICY IF EXISTS "creator_profiles_update_own" ON creator_profiles;
CREATE POLICY "creator_profiles_update_own"
ON creator_profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = creator_profiles.profile_id AND profiles.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = creator_profiles.profile_id AND profiles.user_id = auth.uid())
);

-- ============= DAYS =============
CREATE TABLE IF NOT EXISTS days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  day_date date NOT NULL,
  location text,
  category text NOT NULL DEFAULT 'Developer',
  expected_reach text DEFAULT '~10,000',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'full', 'in_progress', 'completed', 'cancelled')),
  image_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "days_select_public" ON days;
CREATE POLICY "days_select_public"
ON days FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "days_insert_own" ON days;
CREATE POLICY "days_insert_own"
ON days FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = days.creator_id));

DROP POLICY IF EXISTS "days_update_own" ON days;
CREATE POLICY "days_update_own"
ON days FOR UPDATE
TO authenticated
USING (auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = days.creator_id))
WITH CHECK (auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = days.creator_id));

DROP POLICY IF EXISTS "days_delete_own" ON days;
CREATE POLICY "days_delete_own"
ON days FOR DELETE
TO authenticated
USING (auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = days.creator_id));

-- ============= SPONSORSHIP SLOTS =============
CREATE TABLE IF NOT EXISTS sponsorship_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('Primary', 'Featured', 'Supporting')),
  price integer NOT NULL,
  position integer NOT NULL DEFAULT 1,
  description text,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sponsorship_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slots_select_public" ON sponsorship_slots;
CREATE POLICY "slots_select_public"
ON sponsorship_slots FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "slots_insert_own" ON sponsorship_slots;
CREATE POLICY "slots_insert_own"
ON sponsorship_slots FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM days d
    JOIN profiles p ON p.id = d.creator_id
    WHERE d.id = sponsorship_slots.day_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "slots_update_own" ON sponsorship_slots;
CREATE POLICY "slots_update_own"
ON sponsorship_slots FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM days d
    JOIN profiles p ON p.id = d.creator_id
    WHERE d.id = sponsorship_slots.day_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM days d
    JOIN profiles p ON p.id = d.creator_id
    WHERE d.id = sponsorship_slots.day_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "slots_delete_own" ON sponsorship_slots;
CREATE POLICY "slots_delete_own"
ON sponsorship_slots FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM days d
    JOIN profiles p ON p.id = d.creator_id
    WHERE d.id = sponsorship_slots.day_id AND p.user_id = auth.uid()
  )
);

-- ============= SPONSORSHIPS =============
CREATE TABLE IF NOT EXISTS sponsorships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES sponsorship_slots(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  platform_fee integer NOT NULL DEFAULT 0,
  creator_amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'product_shipped', 'product_received', 'day_completed', 'review_pending', 'completed', 'cancelled', 'refunded')),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sponsorships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sponsorships_select_parties" ON sponsorships;
CREATE POLICY "sponsorships_select_parties"
ON sponsorships FOR SELECT
TO authenticated
USING (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.brand_id)
  OR
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.creator_id)
  OR
  auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
);

DROP POLICY IF EXISTS "sponsorships_insert_own" ON sponsorships;
CREATE POLICY "sponsorships_insert_own"
ON sponsorships FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.brand_id)
);

DROP POLICY IF EXISTS "sponsorships_update_parties" ON sponsorships;
CREATE POLICY "sponsorships_update_parties"
ON sponsorships FOR UPDATE
TO authenticated
USING (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.brand_id)
  OR
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.creator_id)
  OR
  auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
)
WITH CHECK (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.brand_id)
  OR
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = sponsorships.creator_id)
  OR
  auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
);

-- ============= REVIEWS =============
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_id uuid NOT NULL REFERENCES sponsorships(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text,
  content text,
  pros text[] DEFAULT '{}',
  cons text[] DEFAULT '{}',
  would_recommend boolean DEFAULT true,
  published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select_public" ON reviews;
CREATE POLICY "reviews_select_public"
ON reviews FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "reviews_insert_creator" ON reviews;
CREATE POLICY "reviews_insert_creator"
ON reviews FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = reviews.sponsorship_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "reviews_update_creator" ON reviews;
CREATE POLICY "reviews_update_creator"
ON reviews FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = reviews.sponsorship_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = reviews.sponsorship_id AND p.user_id = auth.uid()
  )
);

-- ============= DELIVERABLES =============
CREATE TABLE IF NOT EXISTS deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_id uuid NOT NULL REFERENCES sponsorships(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('instagram', 'tiktok', 'youtube', 'x_post', 'photo', 'video', 'blog', 'review')),
  url text,
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deliverables_select_parties" ON deliverables;
CREATE POLICY "deliverables_select_parties"
ON deliverables FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sponsorships s
    WHERE s.id = deliverables.sponsorship_id AND (
      auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = s.brand_id)
      OR
      auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = s.creator_id)
    )
  )
);

DROP POLICY IF EXISTS "deliverables_insert_creator" ON deliverables;
CREATE POLICY "deliverables_insert_creator"
ON deliverables FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = deliverables.sponsorship_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "deliverables_update_creator" ON deliverables;
CREATE POLICY "deliverables_update_creator"
ON deliverables FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = deliverables.sponsorship_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sponsorships s
    JOIN profiles p ON p.id = s.creator_id
    WHERE s.id = deliverables.sponsorship_id AND p.user_id = auth.uid()
  )
);

-- ============= INDEXES =============
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_profiles_profile_id ON creator_profiles(profile_id);
CREATE INDEX IF NOT EXISTS idx_days_creator_id ON days(creator_id);
CREATE INDEX IF NOT EXISTS idx_days_status ON days(status);
CREATE INDEX IF NOT EXISTS idx_slots_day_id ON sponsorship_slots(day_id);
CREATE INDEX IF NOT EXISTS idx_sponsorships_slot_id ON sponsorships(slot_id);
CREATE INDEX IF NOT EXISTS idx_sponsorships_brand_id ON sponsorships(brand_id);
CREATE INDEX IF NOT EXISTS idx_sponsorships_creator_id ON sponsorships(creator_id);
CREATE INDEX IF NOT EXISTS idx_reviews_sponsorship_id ON reviews(sponsorship_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_sponsorship_id ON deliverables(sponsorship_id);
