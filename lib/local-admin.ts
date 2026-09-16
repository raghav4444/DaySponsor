import type { User } from '@supabase/supabase-js';
import type { Profile } from '@/lib/supabase';

export const localAdminSessionKey = 'daysponsor-local-admin';

const localAdminEmail = process.env.NEXT_PUBLIC_TEST_ADMIN_EMAIL;
const localAdminPassword = process.env.NEXT_PUBLIC_TEST_ADMIN_PASSWORD;

export const isLocalAdminCredentials = (email: string, password: string) =>
  Boolean(localAdminEmail && localAdminPassword) &&
  email.trim().toLowerCase() === localAdminEmail!.trim().toLowerCase() &&
  password === localAdminPassword;

export const localAdminUser = {
  id: 'local-test-admin',
  aud: 'authenticated',
  role: 'authenticated',
  email: localAdminEmail,
  app_metadata: {},
  user_metadata: { name: 'Local Test Admin', role: 'admin' },
  created_at: new Date(0).toISOString(),
} as User;

export const localAdminProfile: Profile = {
  id: 'local-test-admin-profile',
  user_id: localAdminUser.id,
  email: localAdminEmail ?? '',
  name: 'Local Test Admin',
  username: 'local-admin',
  avatar_url: null,
  role: 'admin',
  bio: null,
  created_at: new Date(0).toISOString(),
};
