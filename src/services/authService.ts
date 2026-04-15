import { supabase } from '../lib/supabase';

export const authService = {
  async signUp(email: string, password: string) {
    return await supabase.auth.signUp({ email, password });
  },

  async signIn(email: string, password: string) {
    return await supabase.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    await supabase.auth.signOut();
  },

  async getUser() {
    const { data } = await supabase.auth.getUser();
    return data.user;
  },

  async signInWithGoogle() {
    const isNative = !!(window as any).Capacitor;

    // Redirecionar diretamente para o dashboard para evitar perda do hash no redirecionamento da raiz (/)
    const redirectUrl = isNative
      ? 'myapp://auth/callback'
      : `${window.location.origin}/dashboard`;

    return await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl
      }
    });
  }
};
