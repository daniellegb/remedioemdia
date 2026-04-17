import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { platformService } from './platformService';

export const authService = {
  async signUp(email: string, password: string) {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please check your environment variables.');
    }
    try {
      return await supabase.auth.signUp({ email, password });
    } catch (err: any) {
      this.handleAuthError(err);
      throw err;
    }
  },

  async signIn(email: string, password: string) {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please check your environment variables.');
    }
    try {
      return await supabase.auth.signInWithPassword({ email, password });
    } catch (err: any) {
      this.handleAuthError(err);
      throw err;
    }
  },

  async signOut() {
    if (!isSupabaseConfigured()) return;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[AUTH] Sign out error:', err);
    }
  },

  async getUser() {
    if (!isSupabaseConfigured()) return null;
    try {
      const { data } = await supabase.auth.getUser();
      return data.user;
    } catch (err) {
      console.error('[AUTH] Get user error:', err);
      return null;
    }
  },

  async signInWithGoogle() {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please check your environment variables.');
    }
    const redirectUrl = platformService.getRedirectUrl();
    
    try {
      return await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: false
        }
      });
    } catch (err: any) {
      this.handleAuthError(err);
      throw err;
    }
  },

  handleAuthError(err: any) {
    console.error('[AUTH SERVICE ERROR]', err);
    if (err.message?.includes('Failed to fetch') || err.name === 'AuthRetryableFetchError') {
      console.error('[AUTH] Erro de rede detectado. Verifique sua conexão e a URL do Supabase.');
    }
  }
};
