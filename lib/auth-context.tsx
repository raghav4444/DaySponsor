'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase, type Profile } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import {
  localAdminProfile,
  localAdminSessionKey,
  localAdminUser,
} from '@/lib/local-admin';

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * Ensures a profile row exists for the signed-in user. Safe to call when one is
   * already present; returns true once a profile is available.
   */
  ensureProfile: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  ensureProfile: async () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    setProfile(data as Profile | null);
  };

  useEffect(() => {
    let mounted = true;

    const loadLocalAdmin = () => {
      if (window.localStorage.getItem(localAdminSessionKey) !== 'true') return false;
      setUser(localAdminUser);
      setProfile(localAdminProfile);
      setLoading(false);
      return true;
    };

    const handleLocalAdminAuth = () => {
      loadLocalAdmin();
    };

    window.addEventListener('local-admin-auth', handleLocalAdminAuth);
    if (loadLocalAdmin()) {
      return () => window.removeEventListener('local-admin-auth', handleLocalAdminAuth);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await loadProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      window.removeEventListener('local-admin-auth', handleLocalAdminAuth);
    };
  }, []);

  const signOut = async () => {
    window.localStorage.removeItem(localAdminSessionKey);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user.id);
  };

  const ensureProfile = async () => {
    if (profile) return true;
    if (!user) return false;
    // Ask the server to provision (idempotent), then re-read. Covers a Google user whose
    // callback provisioning raced the client's first `getSession`, and a legacy account
    // whose client-side insert was rejected by RLS before the server route existed.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return false;

      const response = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return false;
      const session = (await response.json()) as { profile: Profile | null };
      if (session.profile) {
        setProfile(session.profile);
        return true;
      }

      // No row yet: provision on the server and re-read once more.
      const provisionResponse = await fetch('/api/auth/provision', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!provisionResponse.ok) return false;
      const provisioned = (await provisionResponse.json()) as { profile: Profile | null };
      if (provisioned.profile) {
        setProfile(provisioned.profile);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, signOut, refreshProfile, ensureProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
