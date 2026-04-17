import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
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

  const lastProfileFetchId = React.useRef<string | null>(null);

  const fetchProfile = async (userId: string) => {
    // Evita múltiplas chamadas consecutivas para o mesmo ID se já tivermos os dados
    if (lastProfileFetchId.current === userId && profile && profile.id === userId) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('[AUTH] Erro ao buscar perfil:', error.message);
        return;
      }
      
      if (data) {
        lastProfileFetchId.current = userId;
        setProfile(data as Profile);
      }
    } catch (err) {
      console.error('[AUTH] Erro inesperado ao buscar perfil:', err);
    }
  };

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session: initialSession }, error }) => {
      if (error) {
        // Diferenciamos erro de rede vs erro de credencial
        const isNetworkError = error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('fetch');
        const isCriticalError = error.status === 400 && error.message?.toLowerCase().includes('refresh_token');
        
        console.error('[AUTH] Erro ao recuperar sessão inicial:', error.message);
          
        if (isCriticalError && !isNetworkError) {
          console.warn('[AUTH] Erro de refresh token detectado. Forçando logout.');
          authService.signOut();
        }
        
        setLoading(false);
        return;
      }
      
      if (initialSession) {
        console.log('[AUTH] Sessão inicial detectada para:', initialSession.user.email);
        setSession(initialSession);
        setUser(initialSession.user);
        fetchProfile(initialSession.user.id);
      } else {
        console.log('[AUTH] Nenhuma sessão ativa no boot.');
      }
      
      // DESACOPLADO: O loading de autenticação termina aqui, independentemente do perfil
      setLoading(false);
    }).catch(err => {
      console.error('[AUTH] Erro inesperado no boot de autenticação:', err);
      setLoading(false);
    });

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.log(`[AUTH] Evento de estado: ${event}`);
      
      const newUser = newSession?.user ?? null;
      
      setSession(newSession);
      setUser(newUser);
      
      if (newUser) {
        fetchProfile(newUser.id);
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
        lastProfileFetchId.current = null;
      }
      
      // Garante que o loading pare no primeiro evento de auth se ainda estiver ativo
      setLoading(false);
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
