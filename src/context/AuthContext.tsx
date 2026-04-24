import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getSupabaseStatus } from '../lib/supabase';
import { Profile } from '../../types';
import { authService } from '../services/authService';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoaded: boolean;
  signOut: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<any>;
  signUp: (email: string, password: string) => Promise<any>;
  signInWithGoogle: () => Promise<any>;
  isConfigured: boolean;
  refreshProfile: () => Promise<void>;
  isAdmin: boolean;
  isPremium: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const profileRef = React.useRef<Profile | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  const [loading, setLoading] = useState(true);
  const isConfigured = isSupabaseConfigured();

  const isAdmin = profile?.role === 'admin';
  const isPremium = profile?.plan === 'premium' || profile?.lifetime_access === true;

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('Error fetching profile:', error);
        setProfileLoaded(true);
        return;
      }
      setProfile(data as Profile);
    } catch (err) {
      console.error('Unexpected error fetching profile:', err);
    } finally {
      setProfileLoaded(true);
    }
  };

  useEffect(() => {
    // Diagnostics
    const status = getSupabaseStatus();
    console.log('[Auth] Supabase Status:', status);
    console.log('[Auth] Current Hash:', window.location.hash ? 'Has hash' : 'None');

    if (!isConfigured) {
      setLoading(false);
      return;
    }

    // Wrap initialization in a safe block
    const initAuth = async () => {
      try {
        console.log('[Auth] Initializing session...');
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[Auth] Session error:', error);
          
          // Se o erro for relacionado a refresh token, forçar logout total
          if (
            error.message?.toLowerCase().includes('refresh token') || 
            error.message?.toLowerCase().includes('not found') ||
            error.status === 400
          ) {
            console.warn('[Auth] Critical session error, clearing local state...');
            localStorage.removeItem('med-clean-v3');
            try {
              await supabase.auth.signOut();
            } catch (e) {
              console.error('[Auth] Error calling signOut during cleanup:', e);
            }
            window.location.href = '/login';
            return;
          }
          
          setLoading(false);
          return;
        }

        setSession(session);
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          await fetchProfile(currentUser.id);
        }
      } catch (err) {
        console.error('[Auth] Unexpected initialization error:', err);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Listen for changes on auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      console.log('Auth state change event:', event);
      
      const newUser = currentSession?.user ?? null;
      const isInitialOrTransition = event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED';
      
      // Update session/user and fetch profile
      // We use a functional update or comparison to avoid redundant renders if the user is the same
      setSession(prev => (prev?.access_token === currentSession?.access_token ? prev : currentSession));
      setUser(prev => {
        if (prev?.id !== newUser?.id) {
          if (newUser) setProfileLoaded(false);
          return newUser;
        }
        return prev;
      });
      
      if (newUser) {
        // Only trigger profile fetch if it is a major transition or if we don't have a profile yet
        if (isInitialOrTransition || !profileRef.current) {
          await fetchProfile(newUser.id);
        }
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [isConfigured]);

  const signIn = async (email: string, password: string) => {
    setProfileLoaded(false);
    const { data, error } = await authService.signIn(email, password);
    if (error) throw error;
    return data;
  };

  const signUp = async (email: string, password: string) => {
    setProfileLoaded(false);
    const { data, error } = await authService.signUp(email, password);
    if (error) throw error;
    return data;
  };

  const signInWithGoogle = async () => {
    setProfileLoaded(false);
    const { data, error } = await authService.signInWithGoogle();
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    if (!isConfigured) return;

    try {
      await authService.signOut();
      
      // Placeholder for local notification service cleanup
      // if (localNotificationService?.cancelAll) {
      //   await localNotificationService.cancelAll();
      // }

      setProfile(null);
      setUser(null);
      setSession(null);
    } catch (err) {
      console.error('Error during sign out:', err);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const value = {
    user,
    session,
    profile,
    loading,
    profileLoaded,
    signOut,
    signIn,
    signUp,
    signInWithGoogle,
    isConfigured,
    refreshProfile,
    isAdmin,
    isPremium
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
