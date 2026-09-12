/*
# DaySponsor — Auction, Bid, Shift, Notification, Payment & Audit Schema

Adds the complete backend model for:
- Morning / Afternoon / Night shifts per Day
- Real auction per shift with anti-sniping
- Bid tracking with race-condition-safe atomic operations
- Brand profiles
- Notifications
- Payments & payouts
- Audit log
- Stripe event idempotency
*/

-- ============= BRAND PROFILES =============
CREATE TABLE IF NOT EXISTS brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  company_name text,
  website text,
  logo_url text,
  category text,
  description text,
  contact_email text,
  stripe_customer_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_profiles_select_authenticated"
ON brand_profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "brand_profiles_insert_own"
ON brand_profiles FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = brand_profiles.profile_id AND profiles.user_id = auth.uid()));

CREATE POLICY "brand_profiles_update_own"
ON brand_profiles FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = brand_profiles.profile_id AND profiles.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = brand_profiles.profile_id AND profiles.user_id = auth.uid()));

-- ============= SHIFTS =============
-- Each Day has up to 3 shifts: morning, afternoon, night
CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  shift_type text NOT NULL CHECK (shift_type IN ('morning', 'afternoon', 'night')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  activity text,                    -- what the creator will be doing
  product_category text,            -- preferred product category
  product_notes text,               -- any notes about product preferences
  min_bid_amount integer NOT NULL DEFAULT 50,  -- minimum opening bid in cents/euros
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'open', 'ending_soon', 'closed', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(day_id, shift_type),
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shifts_select_public" ON shifts FOR SELECT TO authenticated USING (true);

CREATE POLICY "shifts_insert_own" ON shifts FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM days d JOIN profiles p ON p.id = d.creator_id
  WHERE d.id = shifts.day_id AND p.user_id = auth.uid()
));

CREATE POLICY "shifts_update_own" ON shifts FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM days d JOIN profiles p ON p.id = d.creator_id
  WHERE d.id = shifts.day_id AND p.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM days d JOIN profiles p ON p.id = d.creator_id
  WHERE d.id = shifts.day_id AND p.user_id = auth.uid()
));

CREATE INDEX IF NOT EXISTS idx_shifts_day_id ON shifts(day_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);

-- ============= AUCTIONS =============
CREATE TABLE IF NOT EXISTS auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
  day_id uuid NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  current_highest_bid integer DEFAULT 0,
  current_winner_id uuid REFERENCES profiles(id),  -- brand profile id
  winning_bid_id uuid,              -- set after closure
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'open', 'ending_soon', 'closed', 'cancelled')),
  anti_snipe_extensions integer DEFAULT 0,
  locked_at timestamptz,            -- set when closure begins (idempotency lock)
  closed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_auction_window CHECK (closes_at > opens_at)
);

ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auctions_select_public" ON auctions FOR SELECT TO authenticated USING (true);

-- Only service role / admin can insert/update auctions (managed server-side)
CREATE POLICY "auctions_insert_service" ON auctions FOR INSERT TO authenticated
WITH CHECK (auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin'));

CREATE POLICY "auctions_update_service" ON auctions FOR UPDATE TO authenticated
USING (auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_auctions_shift_id ON auctions(shift_id);
CREATE INDEX IF NOT EXISTS idx_auctions_day_id ON auctions(day_id);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
CREATE INDEX IF NOT EXISTS idx_auctions_closes_at ON auctions(closes_at);

-- ============= BIDS =============
CREATE TABLE IF NOT EXISTS bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'outbid', 'won', 'lost', 'cancelled', 'invalid')),
  product_description text,         -- what product the brand wants to sponsor with
  product_url text,
  product_type text CHECK (product_type IN ('physical', 'digital', 'saas', 'service', 'experience') OR product_type IS NULL),
  notes text,
  placed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT no_self_bid CHECK (
    brand_id NOT IN (
      SELECT creator_id FROM days d
      JOIN shifts s ON s.day_id = d.id
      JOIN auctions a ON a.shift_id = s.id
      WHERE a.id = bids.auction_id
    )
  )
);

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

-- Brands see their own bids; creator sees bids on their auctions; admin sees all
CREATE POLICY "bids_select_own_or_creator" ON bids FOR SELECT TO authenticated
USING (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = bids.brand_id)
  OR auth.uid() IN (
    SELECT p.user_id FROM profiles p
    JOIN days d ON d.creator_id = p.id
    JOIN shifts s ON s.day_id = d.id
    JOIN auctions a ON a.shift_id = s.id
    WHERE a.id = bids.auction_id
  )
  OR auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
);

-- Brands insert their own bids (server validates via API route)
CREATE POLICY "bids_insert_brand" ON bids FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = bids.brand_id)
  AND (SELECT role FROM profiles WHERE profiles.id = bids.brand_id) = 'brand'
);

-- Only service role updates bids (status changes happen server-side)
CREATE POLICY "bids_update_service" ON bids FOR UPDATE TO authenticated
USING (auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id);
CREATE INDEX IF NOT EXISTS idx_bids_brand_id ON bids(brand_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);
CREATE INDEX IF NOT EXISTS idx_bids_amount ON bids(auction_id, amount DESC);

-- ============= PAYMENTS =============
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_id uuid NOT NULL REFERENCES sponsorships(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES profiles(id),
  amount integer NOT NULL,          -- total charged in smallest currency unit (cents)
  platform_fee integer NOT NULL DEFAULT 0,
  creator_amount integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'disputed')),
  stripe_payment_intent_id text UNIQUE,
  stripe_checkout_session_id text UNIQUE,
  stripe_charge_id text,
  stripe_refund_id text,
  failure_reason text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select_parties" ON payments FOR SELECT TO authenticated
USING (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = payments.brand_id)
  OR auth.uid() IN (
    SELECT p.user_id FROM profiles p
    JOIN sponsorships s ON s.creator_id = p.id
    WHERE s.id = payments.sponsorship_id
  )
  OR auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
);

CREATE INDEX IF NOT EXISTS idx_payments_sponsorship_id ON payments(sponsorship_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_checkout_session_id);

-- ============= PAYOUTS =============
CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_id uuid NOT NULL REFERENCES sponsorships(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES profiles(id),
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  stripe_transfer_id text UNIQUE,
  stripe_payout_id text,
  failure_reason text,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payouts_select_creator_or_admin" ON payouts FOR SELECT TO authenticated
USING (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = payouts.creator_id)
  OR auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
);

CREATE INDEX IF NOT EXISTS idx_payouts_creator_id ON payouts(creator_id);
CREATE INDEX IF NOT EXISTS idx_payouts_sponsorship_id ON payouts(sponsorship_id);

-- ============= NOTIFICATIONS =============
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'new_bid', 'outbid', 'auction_ending', 'auction_won', 'auction_lost',
    'payment_required', 'payment_succeeded', 'payment_failed',
    'product_shipped', 'product_delivered',
    'review_pending', 'review_published',
    'payout_processing', 'payout_paid', 'payout_failed',
    'sponsorship_cancelled', 'dispute_opened', 'admin_action'
  )),
  title text NOT NULL,
  body text,
  data jsonb DEFAULT '{}'::jsonb,   -- arbitrary payload (auction_id, bid_id, etc.)
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON notifications FOR SELECT TO authenticated
USING (auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = notifications.user_id));

CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE TO authenticated
USING (auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = notifications.user_id));

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ============= STRIPE EVENTS (idempotency) =============
CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,              -- Stripe event ID (evt_...)
  type text NOT NULL,
  processed_at timestamptz DEFAULT now(),
  payload jsonb
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
-- Only accessible via service role (no RLS policies for anon/authenticated)

-- ============= AUDIT LOG =============
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES profiles(id),  -- who performed the action
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_select_admin" ON audit_log FOR SELECT TO authenticated
USING (auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ============= REPORTS =============
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES profiles(id),
  resource_type text NOT NULL CHECK (resource_type IN ('review', 'day', 'profile', 'bid', 'sponsorship')),
  resource_id uuid NOT NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES profiles(id),
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_insert_authenticated" ON reports FOR INSERT TO authenticated
WITH CHECK (auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = reports.reporter_id));

CREATE POLICY "reports_select_own_or_admin" ON reports FOR SELECT TO authenticated
USING (
  auth.uid() = (SELECT user_id FROM profiles WHERE profiles.id = reports.reporter_id)
  OR auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin')
);

CREATE POLICY "reports_update_admin" ON reports FOR UPDATE TO authenticated
USING (auth.uid() IN (SELECT user_id FROM profiles WHERE role = 'admin'));

-- ============= ATOMIC BID PLACEMENT FUNCTION =============
-- This function runs in a transaction to prevent race conditions
CREATE OR REPLACE FUNCTION place_bid(
  p_auction_id uuid,
  p_brand_id uuid,
  p_amount integer,
  p_product_description text DEFAULT NULL,
  p_product_url text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auction auctions%ROWTYPE;
  v_brand_role text;
  v_creator_id uuid;
  v_new_bid_id uuid;
  v_prev_winner_id uuid;
  v_anti_snipe_threshold interval := interval '60 seconds';
  v_anti_snipe_extension interval := interval '2 minutes';
  v_now timestamptz := now();
BEGIN
  -- Lock the auction row for update (prevents race conditions)
  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'auction_not_found');
  END IF;

  -- Validate auction is open
  IF v_auction.status NOT IN ('open', 'ending_soon') THEN
    RETURN jsonb_build_object('success', false, 'error', 'auction_not_open', 'status', v_auction.status);
  END IF;

  -- Validate auction has not expired
  IF v_now > v_auction.closes_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'auction_expired');
  END IF;

  -- Validate brand role
  SELECT role INTO v_brand_role FROM profiles WHERE id = p_brand_id;
  IF v_brand_role != 'brand' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_brand');
  END IF;

  -- Validate brand is not the creator of this day
  SELECT d.creator_id INTO v_creator_id
  FROM days d
  JOIN shifts s ON s.day_id = d.id
  WHERE s.id = v_auction.shift_id;

  IF v_creator_id = p_brand_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_bid_own_day');
  END IF;

  -- Validate bid amount exceeds current highest bid
  IF p_amount <= v_auction.current_highest_bid THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'bid_too_low',
      'minimum_required', v_auction.current_highest_bid + 1,
      'current_highest', v_auction.current_highest_bid
    );
  END IF;

  -- Get minimum bid from shift
  IF p_amount < (SELECT min_bid_amount FROM shifts WHERE id = v_auction.shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'below_minimum_bid');
  END IF;

  -- Store previous winner for outbid notification
  v_prev_winner_id := v_auction.current_winner_id;

  -- Mark previous winning bid as outbid
  UPDATE bids
  SET status = 'outbid'
  WHERE auction_id = p_auction_id
    AND status = 'active'
    AND brand_id != p_brand_id;

  -- Insert new bid
  INSERT INTO bids (
    auction_id, brand_id, amount, status,
    product_description, product_url, product_type, notes
  ) VALUES (
    p_auction_id, p_brand_id, p_amount, 'active',
    p_product_description, p_product_url, p_product_type, p_notes
  ) RETURNING id INTO v_new_bid_id;

  -- Update auction with new highest bid
  UPDATE auctions SET
    current_highest_bid = p_amount,
    current_winner_id = p_brand_id,
    updated_at = v_now
  WHERE id = p_auction_id;

  -- Anti-sniping: extend if bid placed in final 60 seconds
  IF (v_auction.closes_at - v_now) < v_anti_snipe_threshold THEN
    UPDATE auctions SET
      closes_at = closes_at + v_anti_snipe_extension,
      status = 'ending_soon',
      anti_snipe_extensions = anti_snipe_extensions + 1,
      updated_at = v_now
    WHERE id = p_auction_id;
  END IF;

  -- Notify previous winner they were outbid
  IF v_prev_winner_id IS NOT NULL AND v_prev_winner_id != p_brand_id THEN
    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (
      v_prev_winner_id,
      'outbid',
      'You have been outbid',
      'A higher bid has been placed. Increase your bid to stay in the lead.',
      jsonb_build_object('auction_id', p_auction_id, 'new_amount', p_amount)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'bid_id', v_new_bid_id,
    'amount', p_amount,
    'auction_id', p_auction_id
  );
END;
$$;

-- ============= ATOMIC AUCTION CLOSE FUNCTION =============
CREATE OR REPLACE FUNCTION close_auction(p_auction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auction auctions%ROWTYPE;
  v_winning_bid bids%ROWTYPE;
  v_shift shifts%ROWTYPE;
  v_day days%ROWTYPE;
  v_sponsorship_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Lock auction row
  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'auction_not_found');
  END IF;

  -- Idempotency: already closed
  IF v_auction.status = 'closed' THEN
    RETURN jsonb_build_object('success', true, 'already_closed', true, 'auction_id', p_auction_id);
  END IF;

  -- Idempotency: already being locked by another process
  IF v_auction.locked_at IS NOT NULL AND (v_now - v_auction.locked_at) < interval '30 seconds' THEN
    RETURN jsonb_build_object('success', false, 'error', 'auction_being_processed');
  END IF;

  -- Set lock
  UPDATE auctions SET locked_at = v_now WHERE id = p_auction_id;

  -- Get shift and day
  SELECT * INTO v_shift FROM shifts WHERE id = v_auction.shift_id;
  SELECT * INTO v_day FROM days WHERE id = v_auction.day_id;

  -- Find highest valid bid
  SELECT * INTO v_winning_bid
  FROM bids
  WHERE auction_id = p_auction_id AND status = 'active'
  ORDER BY amount DESC, placed_at ASC
  LIMIT 1;

  -- Mark all non-winning bids as lost
  UPDATE bids SET status = 'lost'
  WHERE auction_id = p_auction_id AND status IN ('active', 'outbid');

  IF v_winning_bid IS NULL THEN
    -- No bids — close with no winner
    UPDATE auctions SET
      status = 'closed',
      closed_at = v_now,
      updated_at = v_now
    WHERE id = p_auction_id;

    UPDATE shifts SET status = 'closed', updated_at = v_now WHERE id = v_auction.shift_id;

    RETURN jsonb_build_object('success', true, 'winner', false, 'auction_id', p_auction_id);
  END IF;

  -- Mark winning bid
  UPDATE bids SET status = 'won' WHERE id = v_winning_bid.id;

  -- Create sponsorship (idempotent: check if one already exists for this auction)
  IF NOT EXISTS (SELECT 1 FROM sponsorships WHERE slot_id = v_auction.shift_id::text::uuid) THEN
    -- Note: we use shift_id as slot_id for backward compat; in new model slot_id = shift_id
    INSERT INTO sponsorships (
      slot_id, brand_id, creator_id,
      amount, platform_fee, creator_amount,
      status
    ) VALUES (
      v_auction.shift_id,
      v_winning_bid.brand_id,
      v_day.creator_id,
      v_winning_bid.amount,
      ROUND(v_winning_bid.amount * 0.10),
      v_winning_bid.amount - ROUND(v_winning_bid.amount * 0.10),
      'pending'
    ) RETURNING id INTO v_sponsorship_id;
  END IF;

  -- Close auction
  UPDATE auctions SET
    status = 'closed',
    winning_bid_id = v_winning_bid.id,
    current_winner_id = v_winning_bid.brand_id,
    current_highest_bid = v_winning_bid.amount,
    closed_at = v_now,
    updated_at = v_now
  WHERE id = p_auction_id;

  UPDATE shifts SET status = 'closed', updated_at = v_now WHERE id = v_auction.shift_id;

  -- Notify winner
  INSERT INTO notifications (user_id, type, title, body, data)
  VALUES (
    v_winning_bid.brand_id,
    'auction_won',
    'You won the auction!',
    'Congratulations! Your bid won. Complete payment to confirm your sponsorship.',
    jsonb_build_object(
      'auction_id', p_auction_id,
      'sponsorship_id', v_sponsorship_id,
      'amount', v_winning_bid.amount
    )
  );

  -- Notify creator
  INSERT INTO notifications (user_id, type, title, body, data)
  VALUES (
    v_day.creator_id,
    'payment_required',
    'Your shift has a sponsor!',
    'A brand won the auction for your shift. They will complete payment shortly.',
    jsonb_build_object(
      'auction_id', p_auction_id,
      'sponsorship_id', v_sponsorship_id,
      'shift_type', v_shift.shift_type
    )
  );

  -- Notify losing bidders
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT
    b.brand_id,
    'auction_lost',
    'Auction ended',
    'The auction has closed. Unfortunately your bid did not win this time.',
    jsonb_build_object('auction_id', p_auction_id)
  FROM bids b
  WHERE b.auction_id = p_auction_id
    AND b.status = 'lost'
    AND b.brand_id != v_winning_bid.brand_id;

  -- Audit log
  INSERT INTO audit_log (action, resource_type, resource_id, new_data)
  VALUES (
    'auction_closed',
    'auction',
    p_auction_id::text,
    jsonb_build_object(
      'winner_id', v_winning_bid.brand_id,
      'winning_amount', v_winning_bid.amount,
      'sponsorship_id', v_sponsorship_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'winner', true,
    'auction_id', p_auction_id,
    'winning_bid_id', v_winning_bid.id,
    'winner_id', v_winning_bid.brand_id,
    'amount', v_winning_bid.amount,
    'sponsorship_id', v_sponsorship_id
  );
END;
$$;

-- ============= REALTIME PUBLICATIONS =============
-- Enable realtime for auction and bid tables so clients get live updates
ALTER PUBLICATION supabase_realtime ADD TABLE auctions;
ALTER PUBLICATION supabase_realtime ADD TABLE bids;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ============= ADDITIONAL INDEXES =============
CREATE INDEX IF NOT EXISTS idx_brand_profiles_profile_id ON brand_profiles(profile_id);
CREATE INDEX IF NOT EXISTS idx_sponsorships_status ON sponsorships(status);
CREATE INDEX IF NOT EXISTS idx_sponsorships_stripe_pi ON sponsorships(stripe_payment_intent_id);
