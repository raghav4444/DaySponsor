import { z } from 'zod';

// ---- Auth ----
export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(100),
  username: z.string().min(2).max(30).regex(/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers and underscores').optional(),
  role: z.enum(['creator', 'brand']),
});

// ---- Day ----
export const createDaySchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  day_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  location: z.string().max(100).optional(),
  category: z.string().min(1).max(50),
  expected_reach: z.string().max(50).optional(),
  image_url: z.string().url().optional().or(z.literal('')),
});

// ---- Shift ----
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createShiftSchema = z.object({
  day_id: z.string().uuid(),
  shift_type: z.enum(['morning', 'afternoon', 'night']),
  start_time: z.string().regex(timeRegex, 'Invalid time format HH:MM'),
  end_time: z.string().regex(timeRegex, 'Invalid time format HH:MM'),
  activity: z.string().max(500).optional(),
  product_category: z.string().max(100).optional(),
  product_notes: z.string().max(1000).optional(),
  min_bid_amount: z.number().int().min(1).max(100000),
}).refine((data) => data.end_time > data.start_time, {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});

// Enforce canonical shift times
export const SHIFT_TIMES = {
  morning:   { start: '07:00', end: '12:00' },
  afternoon: { start: '12:00', end: '18:00' },
  night:     { start: '18:00', end: '23:59' },
} as const;

// ---- Auction ----
export const createAuctionSchema = z.object({
  shift_id: z.string().uuid(),
  opens_at: z.string().datetime(),
  closes_at: z.string().datetime(),
}).refine((data) => new Date(data.closes_at) > new Date(data.opens_at), {
  message: 'closes_at must be after opens_at',
  path: ['closes_at'],
});

// ---- Bid ----
export const placeBidSchema = z.object({
  auction_id: z.string().uuid(),
  amount: z.number().int().min(1, 'Bid must be at least 1'),
  product_description: z.string().max(500).optional(),
  product_url: z.string().url().optional().or(z.literal('')),
  product_type: z.enum(['physical', 'digital', 'saas', 'service', 'experience']).optional(),
  notes: z.string().max(500).optional(),
});

// ---- Checkout / Payment ----
export const createCheckoutSchema = z.object({
  slot_id: z.string().uuid(),  // sponsorship_slot id (legacy) or shift id
});

// ---- Review ----
export const createReviewSchema = z.object({
  sponsorship_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(200).optional(),
  content: z.string().max(5000).optional(),
  pros: z.array(z.string().max(200)).max(10).optional(),
  cons: z.array(z.string().max(200)).max(10).optional(),
  would_recommend: z.boolean(),
  video_url: z.string().url().optional().or(z.literal('')),
  video_platform: z.enum(['instagram', 'tiktok', 'youtube', 'x', 'other']).optional(),
});

// ---- Sponsorship status transition ----
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:          ['paid', 'cancelled'],
  paid:             ['product_shipped', 'cancelled', 'refunded'],
  product_shipped:  ['product_received'],
  product_received: ['day_completed'],
  day_completed:    ['review_pending'],
  review_pending:   ['completed'],
  completed:        [],
  cancelled:        ['refunded'],
  refunded:         [],
};

export function isValidStatusTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---- Notification mark-read ----
export const markNotificationsReadSchema = z.object({
  notification_ids: z.array(z.string().uuid()).min(1).max(100),
});
