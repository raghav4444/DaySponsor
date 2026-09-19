/**
 * Profile provisioning tests.
 *
 * Provisioning is what makes signup and OAuth login work: the `profiles` row must exist by
 * the time a signed-in user reaches a dashboard, and it must be creatable even when the
 * user has no session yet (the original bug) or arrived from Google with no signup form.
 *
 * These cover the contract `lib/auth-provisioning.ts` promises the rest of the app:
 *  - first creation stores the profile and, for creators, a creator_profiles row;
 *  - a second run for the same user is a no-op that does not duplicate or reset anything;
 *  - an OAuth user with no role metadata becomes a creator;
 *  - a returning user's stored role is never overwritten by metadata;
 *  - a duplicate insert from a race recovers by re-reading.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import * as serverSupabase from '@/lib/server-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createFakeSupabaseState,
  installFakeAdminClient,
  seedDatabase,
  type FakeSupabaseState,
} from './fakes/supabase-fake';
import {
  ensureProfileForUser,
  ensureCreatorProfileForProfileId,
  provisionUser,
} from '@/lib/auth-provisioning';

/**
 * Installs an admin client whose `profiles` lookup always fails, to prove the caller
 * surfaces a lookup error instead of assuming the user has no profile.
 */
function installFailingProfilesLookup(state: FakeSupabaseState): () => void {
  const lookupError = { code: 'PGRST116', message: 'row-level security blocked the read' };
  const failing = {
    select: () => failing,
    eq: () => failing,
    maybeSingle: () => Promise.resolve({ data: null, error: lookupError }),
    insert: () => failing,
    single: () => Promise.resolve({ data: null, error: lookupError }),
  };
  const client = { from: () => failing } as unknown as SupabaseClient;
  const spy = vi.spyOn(serverSupabase, 'getAdminClient').mockReturnValue(client);
  return () => spy.mockRestore();
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'jane@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as User;
}

describe('ensureProfileForUser', () => {
  let state: FakeSupabaseState;
  let restore: () => void;

  beforeEach(() => {
    state = createFakeSupabaseState();
    restore = installFakeAdminClient(state);
  });

  it('creates a profiles row for a new user with the supplied name and role', async () => {
    const user = makeUser();

    const result = await ensureProfileForUser(user, {
      role: 'brand',
      name: 'Jane Doe',
      username: 'janedoe',
    });

    expect(result.created).toBe(true);
    expect(result.profile).toMatchObject({
      user_id: 'user-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
      username: 'janedoe',
      role: 'brand',
    });
    expect(state.database.profiles).toHaveLength(1);
  });

  it('falls back to the OAuth display name when no name is supplied', async () => {
    const user = makeUser({
      user_metadata: { name: 'Google Display Name', avatar_url: 'https://example.com/a.png' },
    });

    const result = await ensureProfileForUser(user);

    expect(result.profile.name).toBe('Google Display Name');
  });

  it('uses the email local part as a name for a user with no name anywhere', async () => {
    const user = makeUser({ email: 'someone@company.com', user_metadata: {} });

    const result = await ensureProfileForUser(user);

    expect(result.profile.name).toBe('someone');
  });

  it('defaults the role to creator when metadata supplies none', async () => {
    // A Google user has no concept of "creator" or "brand": they are a creator by default.
    const user = makeUser({ user_metadata: { name: 'Google User' } });

    const result = await ensureProfileForUser(user);

    expect(result.profile.role).toBe('creator');
  });

  it('is idempotent: a second run returns the stored row without duplicating it', async () => {
    const user = makeUser();

    await ensureProfileForUser(user, { role: 'brand', name: 'Jane Doe' });
    const second = await ensureProfileForUser(user, { role: 'brand', name: 'Jane Doe' });

    expect(second.created).toBe(false);
    expect(state.database.profiles).toHaveLength(1);
    expect(second.profile.user_id).toBe('user-1');
  });

  it('never overwrites the stored role of an existing profile', async () => {
    // A user signed up as a brand must not be downgraded by a stale metadata role on a
    // later login, nor by a retried signup carrying a different one.
    const user = makeUser();

    await ensureProfileForUser(user, { role: 'brand' });

    const stale = await ensureProfileForUser(makeUser({ id: 'user-1' }), { role: 'creator' });

    expect(stale.profile.role).toBe('brand');
    expect(state.database.profiles).toHaveLength(1);
  });

  it('recovers from a lost insert race by re-reading the existing row', async () => {
    const user = makeUser();

    // Simulate a concurrent provision winning between the lookup and the insert.
    state.database.profiles = [
      { id: 'profile-existing', user_id: 'user-1', role: 'brand', email: 'jane@example.com' },
    ];

    const result = await ensureProfileForUser(user, { role: 'creator' });

    expect(result.created).toBe(false);
    expect(result.profile).toMatchObject({ id: 'profile-existing', role: 'brand' });
    expect(state.database.profiles).toHaveLength(1);
  });

  it('throws when the profile lookup fails rather than proceeding blindly', async () => {
    // A lookup error must surface: silently treating it as "no profile" would risk a
    // duplicate insert against a row that does exist.
    restore();
    const failingState = createFakeSupabaseState();
    const failingRestore = installFailingProfilesLookup(failingState);

    await expect(
      ensureProfileForUser(makeUser()),
    ).rejects.toThrow('Could not look up a profile');

    failingRestore();
  });

  it('returns a real profile id, not the array the client hands back', async () => {
    // supabase-js resolves `.insert().select().single()` to an *array*, not a row. Before
    // `asRow` unwrapped it, `profile.id` was undefined and the creator_profiles row was
    // written against the literal string "undefined", unlinking the two tables.
    const result = await ensureProfileForUser(makeUser(), { name: 'Jane Doe' });

    expect(typeof result.profile.id).toBe('string');
    expect(result.profile.id).not.toBe('undefined');
  });
});

describe('ensureCreatorProfileForProfileId', () => {
  let state: FakeSupabaseState;
  let restore: () => void;

  beforeEach(() => {
    state = createFakeSupabaseState();
    restore = installFakeAdminClient(state);
  });

  it('creates a creator_profiles row for a profile that has none', async () => {
    await ensureCreatorProfileForProfileId('profile-1');

    expect(state.database.creator_profiles).toEqual([
      expect.objectContaining({ profile_id: 'profile-1' }),
    ]);
  });

  it('leaves an existing creator profile untouched', async () => {
    // A returning user's earnings and Stripe state must survive a second login.
    state.database.creator_profiles = [
      { id: 'cp-1', profile_id: 'profile-1', total_earned: '125.50', days_sponsored: 3 },
    ];

    await ensureCreatorProfileForProfileId('profile-1');

    expect(state.database.creator_profiles).toHaveLength(1);
    expect(state.database.creator_profiles[0]).toMatchObject({
      total_earned: '125.50',
      days_sponsored: 3,
    });
  });
});

describe('provisionUser', () => {
  let state: FakeSupabaseState;
  let restore: () => void;

  beforeEach(() => {
    state = createFakeSupabaseState();
    restore = installFakeAdminClient(state);
  });

  it('provisioning a creator creates both rows', async () => {
    const result = await provisionUser(makeUser(), { name: 'Jane Doe' });

    expect(result.created).toBe(true);
    expect(state.database.profiles).toHaveLength(1);
    expect(state.database.creator_profiles).toHaveLength(1);
    expect(state.database.creator_profiles[0]).toMatchObject({
      profile_id: result.profile.id,
    });
  });

  it('provisioning a brand creates no creator_profiles row', async () => {
    const result = await provisionUser(makeUser(), { role: 'brand', name: 'Acme Inc' });

    expect(result.profile.role).toBe('brand');
    expect(state.database.creator_profiles ?? []).toHaveLength(0);
  });

  it('links the creator_profiles row to the generated profile id', async () => {
    // The whole point of unwrapping the client's array: the child row must reference the
    // parent's real primary key, so a creator's earnings land against their own profile.
    const result = await provisionUser(makeUser(), { name: 'Jane Doe' });

    expect(state.database.creator_profiles).toHaveLength(1);
    expect(state.database.creator_profiles[0].profile_id).toBe(result.profile.id);
    expect(state.database.creator_profiles[0].profile_id).not.toBe('undefined');
  });

  it('a returning Google user passes through without duplicating rows', async () => {
    await provisionUser(makeUser({ user_metadata: { name: 'Google User' } }));

    const second = await provisionUser(makeUser({ user_metadata: { name: 'Google User' } }));

    expect(second.created).toBe(false);
    expect(state.database.profiles).toHaveLength(1);
    expect(state.database.creator_profiles).toHaveLength(1);
  });
});
