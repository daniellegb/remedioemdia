import { supabase } from '../lib/supabase';
import { Profile } from '../../types';

export const stripeClientService = {
  /**
   * Solicita a criação de uma sessão de checkout ao backend.
   */
  async createCheckoutSession(profile: Profile): Promise<string> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers,
        body: JSON.stringify({ profile }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao criar sessão de checkout');
      }

      return data.url;
    } catch (error: any) {
      console.error('Stripe client error:', error);
      throw error;
    }
  },

  /**
   * Solicita de forma segura a criação de uma sessão no Portal do Cliente Stripe.
   */
  async createPortalSession(profile: Profile, returnUrl: string): Promise<string> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        headers,
        body: JSON.stringify({ profile, returnUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao iniciar portal da assinatura');
      }

      return data.url;
    } catch (error: any) {
      console.error('Stripe portal client error:', error);
      throw error;
    }
  },

  /**
   * Sincroniza o status e datas de assinatura diretamente com a API do Stripe via backend.
   */
  async syncSubscription(userId: string): Promise<Profile> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // Timeout de 6 segundos para segurança

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/stripe/sync-subscription', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao sincronizar assinatura');
      }

      return data.profile;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn('Requisição de sincronização do Stripe expirou (timeout).');
        throw new Error('Sincronização temporariamente indisponível.');
      }
      console.error('Stripe sync client error:', error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
};

