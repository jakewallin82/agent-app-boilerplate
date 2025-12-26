import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { warmupAgent } from '@/lib/api';
import { config } from '@/config';

// Extended user type with admin status
interface ExtendedUser extends User {
  isAdmin?: boolean;
}

interface AuthContextType {
  user: ExtendedUser | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const hasWarmedUp = useRef(false);
  const hasFetchedAdmin = useRef(false);

  // Trigger warmup for agents that support it
  const triggerWarmup = async () => {
    if (hasWarmedUp.current) return;
    hasWarmedUp.current = true;

    // Fire and forget - don't block the UI
    warmupAgent(config.defaultAgentId).catch(() => {});
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Trigger warmup if already logged in
      if (session?.user) {
        triggerWarmup();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        // Trigger warmup on sign in
        if (event === 'SIGNED_IN' && session?.user) {
          triggerWarmup();
        }

        // Reset flags on sign out
        if (event === 'SIGNED_OUT') {
          hasWarmedUp.current = false;
          hasFetchedAdmin.current = false;
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Fetch admin status after auth session is established
  useEffect(() => {
    const fetchAdminStatus = async () => {
      if (!session?.access_token || !user || hasFetchedAdmin.current) return;
      hasFetchedAdmin.current = true;

      try {
        const response = await fetch('/api/agent/me', {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.user?.isAdmin !== undefined) {
            setUser(prev => prev ? { ...prev, isAdmin: data.user.isAdmin } : prev);
          }
        }
      } catch (error) {
        console.error('Failed to fetch admin status:', error);
      }
    };

    fetchAdminStatus();
  }, [session?.access_token, user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
