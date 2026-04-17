import { supabase } from '../lib/supabase';

export const authService = {
  async signUp(email: string, password: string) {
    try {
      return await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });
    } catch (error) {
      console.error('authService.signUp error:', error);
      throw error;
    }
  },

  async signIn(email: string, password: string) {
    try {
      return await supabase.auth.signInWithPassword({ email, password });
    } catch (error) {
      console.error('authService.signIn error:', error);
      throw error;
    }
  },

  async signOut() {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('authService.signOut error:', error);
    }
  },

  async getUser() {
    try {
      const { data } = await supabase.auth.getUser();
      return data.user;
    } catch (error) {
      console.error('authService.getUser error:', error);
      return null;
    }
  },

  async signInWithGoogle() {
    const isNative = !!(window as any).Capacitor?.isNative;
    
    // Configuração para Capacitor (futura implementação mobile)
    const redirectUrl = isNative 
      ? 'io.medmanager.app://auth/callback' 
      : `${window.location.origin}/dashboard`;
    
    console.log('Google login redirectUrl:', redirectUrl);

    try {
      return await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        }
      });
    } catch (error) {
      console.error('authService.signInWithGoogle error:', error);
      throw error;
    }
  }
};
