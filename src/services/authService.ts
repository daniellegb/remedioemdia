import { supabase } from '../lib/supabase';

export const authService = {
  async signUp(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('authService.signUp error:', error);
      return { data: null, error: this.handleAuthError(error) };
    }
  },

  async signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('authService.signIn error:', error);
      return { data: null, error: this.handleAuthError(error) };
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
    const redirectUrl = isNative 
      ? 'io.medmanager.app://auth/callback' 
      : `${window.location.origin}/dashboard`;
    
    console.log('Google login redirectUrl:', redirectUrl);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        }
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('authService.signInWithGoogle error:', error);
      return { data: null, error: this.handleAuthError(error) };
    }
  },

  /**
   * Identifies specific network and DNS failures.
   */
  handleAuthError(error: any): Error {
    const message = error.message || String(error);
    
    if (
      message.includes('Failed to fetch') || 
      message.includes('NetworkError') || 
      message.includes('TypeError') ||
      message.includes('Aborted')
    ) {
      return new Error(
        'Erro Crítico: Não foi possível alcançar o servidor do Supabase. O domínio DNS não foi resolvido. Verifique se o seu projeto no Supabase foi PAUSADO ou EXCLUÍDO, e confirme se o ID do projeto nas variáveis de ambiente da Vercel está correto.'
      );
    }

    if (message.includes('Invalid login credentials')) {
      return new Error('E-mail ou senha incorretos.');
    }

    return error instanceof Error ? error : new Error(message);
  }
};
