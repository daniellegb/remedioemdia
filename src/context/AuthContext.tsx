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
        return;
      }
      setProfile(data as Profile);
    } catch (err) {
      console.error('Unexpected error fetching profile:', err);
    }
  };

  useEffect(() => {
    // Diagnostic log on mount to verify environment variables
    const status = getSupabaseStatus();
    console.log('[Auth] Supabase Configuration:', {
      isConfigured: status.isConfigured,
      url: status.url,
      hasKey: status.isConfigured
    });

    if (!isConfigured) {
      console.error('[Auth] Supabase IS NOT CONFIGURED. Requests will fail.');
      setLoading(false);
      return;
    }

    console.log('[Auth] Current Hash:', window.location.hash ? 'Present' : 'None');

    // Check active sessions and sets the user
    try {
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) {
          console.error('Error getting session:', error);
          // If we get a refresh token error, it's best to sign out to clear local storage
          const isRefreshTokenError = 
            error.message?.includes('Refresh Token Not Found') || 
            error.message?.includes('invalid_refresh_token') ||
            error.message?.includes('Invalid Refresh Token') ||
            (error as any).status === 400 && error.message?.includes('refresh_token');
            
          if (isRefreshTokenError) {
            authService.signOut();
          }
          setLoading(false);
          return;
        }
        
        console.log('Initial session check:', session ? 'User logged in' : 'No session');
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id).finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      }).catch(err => {
        console.error('Unexpected error getting session (promise catch):', err);
        setLoading(false);
      });
    } catch (proxyError) {
      console.error('Supabase client error (Proxy access):', proxyError);
      setLoading(false);
    }

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state change event:', event);
      setSession(session);
      const newUser = session?.user ?? null;
      setUser(newUser);
      
      if (newUser) {
        setLoading(true);
        console.log('User detected, fetching profile...');
        await fetchProfile(newUser.id);
        setLoading(false);
      } else {
        setProfile(null);
        if (event !== 'INITIAL_SESSION') {
          setLoading(false);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [isConfigured]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await authService.signIn(email, password);
    if (error) throw error;
    return data;
  };

  const signUp = async (email: string, password: string) => {
    const { data, error } = await authService.signUp(email, password);
    if (error) throw error;
    return data;
  };

  const signInWithGoogle = async () => {
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
