import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// --- TYPES ---
interface Profile {
  id: string;
  email?: string;
  stripe_customer_id?: string;
  plan?: string;
  subscription_status?: string;
  subscription_ends_at?: string;
  trial_ends_at?: string | null;
  [key: string]: any;
}

// --- SUPABASE ADMIN ---
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[StripeServerService] Missing environment variables: VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(
  supabaseUrl || '',
  supabaseServiceKey || ''
);

// --- STRIPE ---
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

// --- SERVICE ---
export const stripeServerService = {
  /**
   * Cria uma sessão de checkout no Stripe.
   */
  async createCheckoutSession(profile: Profile): Promise<string> {
    const stripe = getStripe();
    let stripeCustomerId = profile.stripe_customer_id;

    // 1. Se não existir stripe_customer_id, criar no Stripe e salvar no Supabase
    if (!stripeCustomerId) {
      console.log(`[StripeServerService] Creating new Stripe customer for user ${profile.id}`);
      const customer = await stripe.customers.create({
        email: profile.email || profile.id,
        metadata: {
          userId: profile.id,
        },
      });
      stripeCustomerId = customer.id;

      // Salvar no Supabase usando Admin
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', profile.id);

      if (updateError) {
        console.error('[StripeServerService] Erro ao salvar stripe_customer_id no Supabase:', updateError.message);
        throw new Error('Falha ao vincular cliente Stripe ao perfil.');
      }
    }

    // 2. Criar checkout session
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      throw new Error('STRIPE_PRICE_ID environment variable is required');
    }

    const appUrl = process.env.APP_URL || 'https://remedioemdia.vercel.app';

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
      success_url: `${appUrl}/subscription/success`,
      cancel_url: `${appUrl}/subscription/cancel`,
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
      console.error(`[StripeServerService] Webhook signature verification failed: ${err.message}`);
      throw new Error(`Webhook Error: ${err.message}`);
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [StripeServerService] EVENT TYPE: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const sessionId = session.id;
        console.log(`[${timestamp}] [StripeServerService] CHECKOUT SESSION ID: ${sessionId} for User: ${userId}`);
        
        if (userId) {
          await this.updateProfileSubscription(userId, {
            plan: 'premium',
            subscription_status: 'active',
            trial_ends_at: null,
          });
        } else {
          console.warn(`[${timestamp}] [StripeServerService] No userId found in metadata for session ${sessionId}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;
        const subscriptionId = invoice.subscription;
        
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId as string) as any;
        const userId = subscription.metadata?.userId;

        if (userId) {
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
          await this.updateProfileSubscription(userId, {
            subscription_status: 'expired',
          });
        }
        break;
      }

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
        console.log(`[${timestamp}] [StripeServerService] Unhandled event type ${event.type}`);
    }
  },

  /**
   * Utilitário para atualizar perfil no Supabase Admin.
   */
  async updateProfileSubscription(userId: string, updates: any) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error(`[StripeServerService] SUPABASE UPDATE FAIL for profile ${userId}: ${error.message}`);
      throw error;
    }

    console.log(`[StripeServerService] SUPABASE UPDATE SUCCESS for profile ${userId}. Updates: ${JSON.stringify(updates)}`);
    return data;
  }
};
