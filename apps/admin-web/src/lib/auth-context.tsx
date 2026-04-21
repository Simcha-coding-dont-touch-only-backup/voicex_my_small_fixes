import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  hasPermission as sharedHasPermission,
  isSuperAdmin as sharedIsSuperAdmin,
  type AdminPermissionKey,
  type AdminUser,
} from '@voicex/shared';
import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  adminUser: AdminUser | null;
  loading: boolean;
  /** Set when /me returns 403 (Supabase user but not in admin_users). */
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasPermission: (key: AdminPermissionKey) => boolean;
  isSuperAdmin: () => boolean;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  adminUser: null,
  loading: true,
  authError: null,
  signIn: async () => {},
  signOut: async () => {},
  hasPermission: () => false,
  isSuperAdmin: () => false,
});

interface MeResponse {
  success: boolean;
  data?: AdminUser;
  error?: string;
}

async function fetchAdminMe(
  token: string,
  signal?: AbortSignal
): Promise<{ user: AdminUser | null; error: string | null; aborted?: boolean }> {
  try {
    const resp = await fetch('/api/admin/me', {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (resp.status === 401 || resp.status === 403) {
      const body = (await resp.json().catch(() => ({}))) as MeResponse;
      return { user: null, error: body.error || 'Not an admin user' };
    }
    if (!resp.ok) {
      return { user: null, error: `Failed to load profile (${resp.status})` };
    }
    const body = (await resp.json()) as MeResponse;
    if (!body.success || !body.data) {
      return { user: null, error: body.error || 'Failed to load profile' };
    }
    return { user: body.data, error: null };
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      return { user: null, error: null, aborted: true };
    }
    return { user: null, error: err?.message || 'Failed to load profile' };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadAdmin = useCallback(
    async (currentSession: Session | null, signal?: AbortSignal) => {
      if (signal?.aborted) return;
      if (!currentSession?.access_token) {
        if (signal?.aborted) return;
        setAdminUser(null);
        setAuthError(null);
        return;
      }
      const { user, error, aborted } = await fetchAdminMe(
        currentSession.access_token,
        signal
      );
      if (aborted || signal?.aborted) return;
      if (error) {
        // Don't auto-signOut here: doing so would fire onAuthStateChange and
        // re-enter loadAdmin in a loop, and would also clear `authError`
        // before the user could read it. Just expose the error; the
        // ProtectedRoutes wrapper will surface it.
        setAdminUser(null);
        setAuthError(error);
        return;
      }
      setAdminUser(user);
      setAuthError(null);
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      const { data: { session: initial } } = await supabase.auth.getSession();
      if (signal.aborted) return;
      setSession(initial);
      await loadAdmin(initial, signal);
      if (!signal.aborted) setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        if (signal.aborted) return;
        setSession(nextSession);
        await loadAdmin(nextSession, signal);
      }
    );

    return () => {
      controller.abort();
      subscription.unsubscribe();
    };
  }, [loadAdmin]);

  const signIn = async (email: string, password: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // The onAuthStateChange handler will populate adminUser. If the user is
    // not an admin, loadAdmin will sign them back out and set authError.
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setAdminUser(null);
    setAuthError(null);
  };

  const hasPermission = useCallback(
    (key: AdminPermissionKey) => sharedHasPermission(adminUser, key),
    [adminUser]
  );
  const isSuperAdmin = useCallback(() => sharedIsSuperAdmin(adminUser), [adminUser]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        adminUser,
        loading,
        authError,
        signIn,
        signOut,
        hasPermission,
        isSuperAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
