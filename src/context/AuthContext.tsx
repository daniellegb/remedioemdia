// ⚠️ Nunca usar profile.plan diretamente para controle de acesso.
// Sempre usar hasPremiumAccess(profile)

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getSupabaseStatus } from '../lib/supabase';
import { Profile } from '../../types';
import { authService } from '../services/authService';
import { hasPremiumAccess } from '../utils/subscriptionUtils';
import { subscriptionService } from '../services/subscriptionService';
import { sessionService } from '../services/sessionService';
import { generateUUID } from '../utils/userAgent';

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
  currentSessionId: string;
}


const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const profileRef = React.useRef<Profile | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  const [loading, setLoading] = useState(true);
  const isConfigured = isSupabaseConfigured();

  const isAdmin = profile?.role === 'admin';
  const isPremium = hasPremiumAccess(profile);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      // Tentar buscar do backend
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.warn('Error fetching profile from backend, checking cache...', error);
        
        // Se falhar (ex: offline), tentar carregar do cache local
        const cachedSubscription = subscriptionService.getFromCache(userId);
        if (cachedSubscription) {
          // Criar um perfil parcial baseado no cache para não quebrar o app
          // Em um app real, salvaríamos o perfil completo no cache
          const mockProfile: any = {
            id: userId,
            ...cachedSubscription,
            onboarding_completed: true, // Assumindo se já tinha cache
          };
          setProfile(subscriptionService.applyLocalExpirationLogic(mockProfile));
        }
        
        setProfileLoaded(true);
        return;
      }
      
      const currentProfile = data as Profile;
      
      // Fetch user metadata backup for account deletion properties
      let meta: any = {};
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.user_metadata) {
          meta = user.user_metadata;
        }
      } catch (metaErr) {
        console.warn('[AuthContext] Error retrieving user metadata backup:', metaErr);
      }

      const mergedProfile: Profile = {
        ...currentProfile,
        account_status: currentProfile.account_status || meta.account_status || 'active',
        deletion_requested_at: currentProfile.deletion_requested_at || meta.deletion_requested_at || null,
        scheduled_deletion_at: currentProfile.scheduled_deletion_at || meta.scheduled_deletion_at || null
      };

      const updatedProfile = await subscriptionService.refreshSubscriptionStatus(mergedProfile);
      setProfile(updatedProfile);
    } catch (err) {
      console.error('Unexpected error fetching profile:', err);
    } finally {
      setProfileLoaded(true);
    }
  }, [isConfigured]);

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

  useEffect(() => {
    if (!user || !isConfigured) return;

    console.log(`[AuthContext] Initializing Realtime listener for profile-changes for user: ${user.id}`);
    const channel = supabase
      .channel(`profile-db-changes-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` }, async (payload) => {
        console.log('[AuthContext] Profiles table changed. Tracing updates:', payload);
        if (payload.new) {
          await fetchProfile(user.id);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, isConfigured, fetchProfile]);

  useEffect(() => {
    if (!user || !isConfigured) {
      setCurrentSessionId('');
      return;
    }

    let localId = localStorage.getItem('medmanager_v2_session_id');
    if (!localId || localId === 'undefined' || localId === 'null' || localId.trim() === '') {
      localId = generateUUID();
      localStorage.setItem('medmanager_v2_session_id', localId);
    }
    setCurrentSessionId(localId);

    let isRegisteredOnDb = false;
    let sessionDbId: string | null = null;
    let isRevoked = false;

    const handleRemoteLogout = async () => {
      if (isRevoked) return;
      isRevoked = true;
      console.warn('[SessionTracker] Current session has been remotely revoked or terminated. Forcing local logout.');
      setProfile(null);
      setUser(null);
      setSession(null);
      localStorage.removeItem('medmanager_v2_session_id');
      try {
        await authService.signOut({ scope: 'local' });
      } catch (signOutError) {
        console.error('[SessionTracker] Error signing out via authService:', signOutError);
      }
      window.location.href = '/login?revoked=true';
    };

    // Async registration
    sessionService.registerSession(user.id, localId)
      .then((sess) => {
        if (sess) {
          isRegisteredOnDb = true;
          sessionDbId = sess.id;
          console.log('[SessionTracker] Current session registered in public.active_sessions with DB ID:', sess.id);
        }
      })
      .catch(err => console.error('[SessionTracker] Error registering session:', err));

    // Supabase Realtime Channel to detect instant logout
    const channel = supabase
      .channel(`active-sessions-channel-${user.id}-${localId}`)
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'active_sessions'
      }, (payload) => {
        console.log('[SessionTracker] Realtime DELETE payload received:', JSON.stringify(payload));
        const oldRow = payload.old;
        if (oldRow) {
          // Robust checking: verify that localId and oldRow variables are actual valid session keys and not placeholders/undef
          const isLocalIdValid = !!(localId && localId !== 'undefined' && localId !== 'null' && localId.trim() !== '');
          const isOldRowSessionIdValid = !!(oldRow.session_id && oldRow.session_id !== 'undefined' && oldRow.session_id !== 'null' && oldRow.session_id.trim() !== '');
          
          // 1. If oldRow has session_id (new schema where session_id is Primary Key)
          const matchesSecId = isLocalIdValid && isOldRowSessionIdValid && oldRow.session_id === localId;
          
          // 2. If oldRow only has the row's surrogate id (old schema where id is Primary Key)
          const isSessionDbIdValid = !!(sessionDbId && sessionDbId !== 'undefined' && sessionDbId !== 'null' && sessionDbId.trim() !== '');
          const isOldRowIdValid = !!(oldRow.id && oldRow.id !== 'undefined' && oldRow.id !== 'null' && oldRow.id.trim() !== '');
          const matchesDbId = isSessionDbIdValid && isOldRowIdValid && oldRow.id === sessionDbId;
          
          console.log('[SessionTracker] Match evaluation:', {
            matchesSecId,
            matchesDbId,
            oldRowSessionId: oldRow.session_id,
            localId,
            oldRowId: oldRow.id,
            sessionDbId,
            isLocalIdValid,
            isOldRowSessionIdValid,
            isSessionDbIdValid,
            isOldRowIdValid
          });
          
          if (matchesSecId || matchesDbId) {
            console.log('[SessionTracker] Match found! Initiating instant remote sign out...');
            handleRemoteLogout();
          }
        }
      })
      .subscribe((status) => {
        console.log(`[SessionTracker] Realtime subscription status: ${status}`);
      });

    // Stand up periodic activity update & validity checking (fallback)
    const interval = setInterval(async () => {
      if (!user?.id || !localId) return;
      try {
        if (isRegisteredOnDb) {
          const isValid = await sessionService.isSessionValid(user.id, localId);
          if (!isValid) {
            handleRemoteLogout();
            return;
          }

          // Active, update last activity timestamp of current session
          await sessionService.updateActivity(user.id, localId);
        } else {
          // Retry registration if it previously failed (high resilience)
          const sess = await sessionService.registerSession(user.id, localId);
          if (sess) {
            isRegisteredOnDb = true;
            sessionDbId = sess.id;
            console.log('[SessionTracker] Current session successfully registered (retry).');
          }
        }
      } catch (err) {
        console.warn('[SessionTracker] Transient background network check warning:', err);
      }
    }, 20 * 1000); // Fallback check every 20 seconds

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user?.id, isConfigured]);


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
      // Clean up local state immediately to ensure a seamless UI transition
      setProfile(null);
      setUser(null);
      setSession(null);
      
      const localId = localStorage.getItem('medmanager_v2_session_id');
      if (localId) {
        try {
          await sessionService.revokeSession(localId);
        } catch (dbErr) {
          console.warn('[AuthContext] Error revoking session entry on manual sign out:', dbErr);
        }
        localStorage.removeItem('medmanager_v2_session_id');
      }

      await authService.signOut({ scope: 'local' });
    } catch (err) {
      console.error('Error during sign out:', err);
    } finally {
      // Force visual state reset regardless of errors during network signout
      setProfile(null);
      setUser(null);
      setSession(null);
      localStorage.removeItem('medmanager_v2_session_id');
    }
  };

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  }, [user?.id, fetchProfile]);

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
    isPremium,
    currentSessionId
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
