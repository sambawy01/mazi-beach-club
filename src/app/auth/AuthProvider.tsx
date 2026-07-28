import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

// ── Types ───────────────────────────────────────────────────────────────────
export interface Profile {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** The user's `profiles` row, or null if they haven't completed it yet. */
  profile: Profile | null;
  /** True while the initial session/profile load is in flight. */
  loading: boolean;
  /**
   * True once the initial profile fetch has resolved. Distinguishes
   * "no profile loaded yet" from "loaded and genuinely profile-less", so
   * returning users don't flash the profile-completion step.
   */
  profileLoaded: boolean;
  /** Step 1 of sign-in: request an email OTP code (creates the user if new). */
  signInWithOtp: (email: string) => Promise<void>;
  /** Step 2 of sign-in: verify the 6-digit OTP code for the given email. */
  verifyOtp: (email: string, code: string) => Promise<void>;
  /** Sign the user out and clear the persisted session. */
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row (e.g. after completing it). */
  refreshProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Guards against setting state after unmount. It says nothing about ordering:
  // it is true for every concurrent applySession run, so it cannot discriminate
  // between them — `applySeq` below does that.
  const mounted = useRef(true);

  // Monotonic token for applySession runs. Each run claims the next value and
  // re-checks, after every await, that it is still the newest one. Without this
  // an older, slower profile fetch can land after a newer session was applied:
  // sign-out would end with `session === null` but a stale `profile`, and an
  // A → B account switch could pair B's session with A's profile — which the
  // order/reservation forms would then submit as A's name+phone under B's uid.
  const applySeq = useRef(0);

  // The user id whose profile fetch has actually been applied. `profileLoaded`
  // must mean "THIS user's profile has settled" — not merely "some profile
  // settled once" — otherwise a sign-out → sign-in (no page reload) leaves it
  // stale-true while `profile` is still null, and consumers that gate a
  // one-time prefill on it seed from an empty profile and latch.
  const loadedProfileFor = useRef<string | null>(null);

  const fetchProfile = useCallback(
    async (userId: string): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone, created_at, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        // Don't throw — a missing profile (or transient error) shouldn't break auth.
        console.error('Failed to load profile:', error.message);
        return null;
      }
      return (data as Profile) ?? null;
    },
    []
  );

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    const currentUser = user;
    if (!currentUser) {
      if (mounted.current) setProfile(null);
      return null;
    }
    // Participate in the same monotonic sequence applySession uses. Without this a
    // concurrent account switch could land this user's profile after a newer
    // session — the crossover applySeq exists to prevent.
    const seq = ++applySeq.current;
    const p = await fetchProfile(currentUser.id);
    if (!mounted.current || seq !== applySeq.current) return p;
    setProfile(p);
    return p;
  }, [user, fetchProfile]);

  // Initial load + auth state subscription.
  useEffect(() => {
    mounted.current = true;

    // Apply a session (and its profile) to state.
    const applySession = async (nextSession: Session | null) => {
      if (!mounted.current) return;
      // Claim this run. Any later applySession bumps the counter and this run
      // becomes a no-op at its next checkpoint.
      const seq = ++applySeq.current;
      const nextUser = nextSession?.user ?? null;

      // A different user (sign-in, sign-out, or account switch) invalidates the
      // previous profile load: `profileLoaded` goes back to false and the stale
      // profile is cleared until this user's fetch resolves, so nobody reads one
      // user's profile against another's session. A TOKEN_REFRESHED for the SAME
      // user skips this — the flag stays true and no consumer flashes. This runs
      // synchronously (before any await), so it always reflects the *applied*
      // user, never one that a slower in-flight fetch is still chasing.
      if (loadedProfileFor.current !== (nextUser?.id ?? null)) {
        setProfileLoaded(false);
        setProfile(null);
      }

      setSession(nextSession);
      setUser(nextUser);

      if (nextUser) {
        const p = await fetchProfile(nextUser.id);
        // A newer applySession (sign-out, account switch) started while this
        // fetch was in flight — it owns the state now, so drop this result.
        if (!mounted.current || seq !== applySeq.current) return;
        setProfile(p);
      } else {
        if (!mounted.current) return;
        setProfile(null);
      }

      // This user's profile fetch (or lack thereof) has now resolved, and this
      // run is still the newest — safe to publish the "settled" markers.
      if (seq !== applySeq.current) return;
      loadedProfileFor.current = nextUser?.id ?? null;
      setProfileLoaded(true);
    };

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        await applySession(data.session ?? null);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Defer the profile query off GoTrue's auth-state lock: running Supabase
      // queries synchronously inside this callback while persistSession /
      // autoRefresh hold the lock is a documented deadlock risk. applySession
      // still guards for unmount internally.
      setTimeout(() => {
        void applySession(nextSession);
      }, 0);
    });

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithOtp = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) throw error;
    // onAuthStateChange will pick up the new session and load the profile.
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value: AuthContextValue = {
    session,
    user,
    profile,
    loading,
    profileLoaded,
    signInWithOtp,
    verifyOtp,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
