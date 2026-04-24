import { supabase } from '../lib/supabase';

export const authService = {
  async signUp(email: string, password: string) {
    return await supabase.auth.signUp({ 
      email, 
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`
      }
    });
  },

  async signIn(email: string, password: string) {
    return await supabase.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    try {
      await supabase.auth.signOut();
    } catch (error: any) {
      console.error('authService.signOut error:', error);
      // fallback: forçar limpeza se houver erro ou se for erro de refresh token
      if (error.message?.toLowerCase().includes('refresh token') || error.message?.toLowerCase().includes('not found')) {
        localStorage.removeItem('med-clean-v3');
      }
    } finally {
      // Garantir limpeza no storage key configurado
      localStorage.removeItem('med-clean-v3');
    }
  },

  async getUser() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } catch (error) {
      console.error('authService.getUser error:', error);
      return null;
    }
  },

  async signInWithGoogle() {
    const isNative = !!(window as any).Capacitor?.isNative;
    const redirectUrl = isNative 
      ? 'io.medmanager.app://auth/callback' 
      : `${window.location.origin}/dashboard`;
    
    console.log('Google login redirectUrl:', redirectUrl);

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
  }
};
