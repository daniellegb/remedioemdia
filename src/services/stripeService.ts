import Stripe from 'stripe';
import { supabase } from '../lib/supabase';
import { Profile } from '../../types';

let stripeClient: Stripe | null = null;

function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeClient = new Stripe(key, {
      apiVersion: '2025-01-27.acacia' as any,
    });
  }
  return stripeClient;
}

export const stripeService = {
  /**
   * Cria uma sessão de checkout no Stripe integrado com Profile e Supabase.
   */
  async createCheckoutSession(profile: Profile): Promise<string> {
    const stripe = getStripe();
    let stripeCustomerId = profile.stripe_customer_id;

    // 1. Se não existir stripe_customer_id, criar no Stripe e salvar no Supabase
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: profile.id, // Ou use profile.email se disponível, mas aqui o ID é o que temos no metadata
        metadata: {
          userId: profile.id,
        },
      });
      stripeCustomerId = customer.id;

      // Salvar no Supabase
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', profile.id);

      if (updateError) {
        console.error('Erro ao salvar stripe_customer_id no Supabase:', updateError);
        throw new Error('Falha ao vincular cliente Stripe ao perfil.');
      }
    }

    // 2. Criar checkout session
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      throw new Error('STRIPE_PRICE_ID environment variable is required');
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_URL || 'http://localhost:3000'}/subscription/success`,
      cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/subscription/cancel`,
      metadata: {
        userId: profile.id,
      },
    });

    if (!session.url) {
      throw new Error('Falha ao gerar URL da sessão de checkout.');
    }

    return session.url;
  },

  /**
   * Processa webhooks do Stripe.
   */
  async handleWebhook(sig: string, rawBody: Buffer) {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed.`, err.message);
      throw new Error(`Webhook Error: ${err.message}`);
    }

    console.log(`Processing event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        if (userId) {
          await this.updateProfileSubscription(userId, {
            plan: 'premium',
            subscription_status: 'active',
            trial_ends_at: null,
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;
        const subscriptionId = invoice.subscription;
        
        if (!subscriptionId) break;

        // Buscar userId por customerId se não estiver no metadata
        const subscription = await stripe.subscriptions.retrieve(subscriptionId as string) as any;
        const userId = subscription.metadata?.userId;

        if (userId) {
          // Calcular nova data de expiração (do período atual da assinatura)
          const endsAt = new Date(subscription.current_period_end * 1000).toISOString();
          await this.updateProfileSubscription(userId, {
            subscription_status: 'active',
            subscription_ends_at: endsAt,
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const userId = subscription.metadata?.userId;
        if (userId) {
          // Quando deletado (expirado ou cancelado totalmente), alteramos status para canceled
          // (No sistema anterior, 'canceled' significa 'cancelado pelo usuário mas ainda com acesso' 
          // ou 'fatura não paga'. Se deletado no Stripe, o acesso expirou.)
          await this.updateProfileSubscription(userId, {
            subscription_status: 'canceled',
          });
        }
        break;
      }

      // Outros eventos úteis
      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        const userId = subscription.metadata?.userId;
        if (userId) {
          if (subscription.cancel_at_period_end) {
            await this.updateProfileSubscription(userId, {
              subscription_status: 'canceled',
            });
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  },

  /**
   * Utilitário para atualizar perfil no Supabase.
   */
  async updateProfileSubscription(userId: string, updates: Partial<Profile>) {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error(`Erro ao atualizar perfil ${userId}:`, error);
      throw error;
    }

    console.log(`Perfil ${userId} atualizado com sucesso:`, updates);
    return data as Profile;
  }
};
