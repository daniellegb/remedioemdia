import { Profile } from '../../types';

export const stripeClientService = {
  /**
   * Solicita a criação de uma sessão de checkout ao backend.
   */
  async createCheckoutSession(profile: Profile): Promise<string> {
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
  }
};
