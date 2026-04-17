import { supabase } from '../lib/supabase';
import { platformService } from './platformService';

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
    const redirectUrl = platformService.getRedirectUrl();
    
    return await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: false // Garante o fluxo padrão
      }
    });
  }
};
