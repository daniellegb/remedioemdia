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

    // Fetch authenticated user from Supabase Auth to get the real email address
    let user: any = null;
    try {
      const { data, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
      if (userError) {
        console.error('[StripeServerService] Error fetching user from auth:', userError.message);
      } else {
        user = data.user;
      }
    } catch (e: any) {
      console.error('[StripeServerService] Exception fetching user from auth:', e.message);
    }

    // Temporary debug logs
    console.log('[StripeServerService] Checkout session user validation:', {
      userId: user?.id,
      userEmail: user?.email,
      profileEmail: profile?.email,
    });

    // Validate if existing stripe_customer_id still exists in Stripe
    if (stripeCustomerId) {
      try {
        console.log(`[StripeServerService] Verifying existing Stripe customer ${stripeCustomerId}`);
        const customer = await stripe.customers.retrieve(stripeCustomerId);
        if (customer.deleted) {
          console.warn(`[StripeServerService] Stripe customer ${stripeCustomerId} is marked as deleted. Resetting.`);
          stripeCustomerId = undefined;
        }
      } catch (err: any) {
        if (err?.code === 'resource_missing' || err?.statusCode === 404 || err?.message?.includes('No such customer')) {
          console.warn(`[StripeServerService] Stripe customer ${stripeCustomerId} not found in Stripe Dashboard (No such customer). Resetting.`);
          stripeCustomerId = undefined;
        } else {
          console.error('[StripeServerService] Unexpected error retrieving Stripe customer:', err.message);
          throw err;
        }
      }
    }

    // 1. Se não existir stripe_customer_id (ou foi resetado por não existir mais no Stripe), criar no Stripe e salvar no Supabase
    if (!stripeCustomerId) {
      console.log(`[StripeServerService] Creating new Stripe customer for user ${profile.id}`);
      const customer = await stripe.customers.create({
        email: user?.email || profile.email || undefined,
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
      subscription_data: {
        metadata: {
          userId: profile.id,
        },
      },
    });

    if (!session.url) {
      throw new Error('Falha ao gerar URL da sessão de checkout.');
    }

    return session.url;
  },

  /**
   * Processa webhooks do Stripe.
   * Fluxo: Stripe -> Vercel Endpoint (Raw Body) -> handleWebhook (Signature Validation) -> Supabase (Persistence)
   */
  async handleWebhook(sig: string, rawBody: Buffer) {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event;

    // 1. Validar assinatura (Garante que o payload veio do Stripe e não foi alterado)
    try {
      const payloadString = rawBody.toString('utf8');
      console.log(`[StripeServerService] Payload start: ${payloadString.substring(0, 50)}...`);
      console.log(`[StripeServerService] Secret prefix: ${webhookSecret?.substring(0, 7)}***`);
      
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error(`[StripeServerService] Webhook signature verification failed: ${err.message}`);
      throw new Error(`Webhook Error: ${err.message}`);
    }

    const timestamp = new Date().toISOString();
    const eventId = event.id;
    console.log(`[${timestamp}] [StripeServerService] EVENT RECEIVED: ${eventId} [${event.type}]`);

    // 2. Garantir Idempotência (Não processar o mesmo evento duas vezes)
    const { data: existingEvent } = await supabaseAdmin
      .from('stripe_events')
      .select('id')
      .eq('stripe_event_id', eventId)
      .maybeSingle();

    if (existingEvent) {
      console.log(`[${timestamp}] [StripeServerService] Event ${eventId} already processed. Skipping.`);
      return;
    }

    // Identificar IDs comuns para auditoria
    let stripeCustomerId: string | null = null;
    let stripeSubscriptionId: string | null = null;
    let stripeSessionId: string | null = null;
    let userId: string | null = null;

    // 3. Processar Evento
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          userId = session.metadata?.userId || null;
          stripeCustomerId = session.customer as string;
          stripeSubscriptionId = session.subscription as string;
          stripeSessionId = session.id;

          console.log(`[${timestamp}] [StripeServerService] Processing Checkout Completed for User: ${userId}`);
          
          if (userId) {
            await this.updateProfileSubscription(userId, {
              plan: 'premium',
              subscription_status: 'active',
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: stripeSubscriptionId,
              subscription_ends_at: null,
              trial_ends_at: null,
            });
          } else {
            console.warn(`[${timestamp}] [StripeServerService] MISSING userId in metadata for session ${stripeSessionId}`);
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          stripeSubscriptionId = invoice.subscription as string;
          stripeCustomerId = invoice.customer as string;
          
          if (!stripeSubscriptionId) break;

          const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
          userId = (subscription.metadata?.userId as string) || null;

          if (userId) {
            const endsAt = new Date(subscription.current_period_end * 1000).toISOString();
            await this.updateProfileSubscription(userId, {
              subscription_status: 'active',
              subscription_ends_at: endsAt,
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: stripeSubscriptionId,
            });
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          stripeCustomerId = subscription.customer as string;
          stripeSubscriptionId = subscription.id;
          
          const rawMetadataUserId = subscription.metadata?.userId;
          userId = (rawMetadataUserId && rawMetadataUserId !== 'null' && rawMetadataUserId !== '') ? (rawMetadataUserId as string) : null;

          console.log('customer.subscription.deleted received', {
            stripeCustomerId,
            stripeSubscriptionId,
            userId,
            timestamp
          });

          const updates = {
            plan: 'free',
            subscription_status: 'canceled',
            subscription_ends_at: new Date().toISOString(),
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          };

          if (userId) {
            console.log(`[${timestamp}] [StripeServerService] Downgrading subscription using Metadata User ID: ${userId}`);
            await this.updateProfileSubscription(userId, updates);
          } else if (stripeCustomerId) {
            console.log('attempting downgrade via stripe_customer_id', { stripeCustomerId, updates });

            const { data, error } = await supabaseAdmin
              .from('profiles')
              .update(updates)
              .eq('stripe_customer_id', stripeCustomerId)
              .select();

            console.log('supabase update result', { data, error });

            if (error) {
              console.error('supabase update failed', { stripeCustomerId, error: error.message });
              throw error;
            }

            if (data && data.length > 0) {
              userId = data[0].id; // Resolve user ID for events logging audit
              console.log(`[StripeServerService] SUPABASE UPDATE SUCCESS for stripe_customer_id ${stripeCustomerId}. User ID: ${userId}`);
            } else {
              console.warn(`[StripeServerService] SUPABASE UPDATE WARNING: No profile found to update with stripe_customer_id: ${stripeCustomerId}`);
            }
          } else {
            console.error(`[${timestamp}] [StripeServerService] Cannot handle subscription delete: both userId and stripeCustomerId are missing.`);
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          userId = (subscription.metadata?.userId as string) || null;
          stripeCustomerId = subscription.customer as string;
          stripeSubscriptionId = subscription.id;

          if (userId) {
            if (subscription.cancel_at_period_end) {
              await this.updateProfileSubscription(userId, {
                subscription_status: 'canceled',
              });
            } else if (subscription.status === 'active') {
              await this.updateProfileSubscription(userId, {
                subscription_status: 'active',
              });
            }
          }
          break;
        }

        default:
          console.log(`[${timestamp}] [StripeServerService] Unhandled event type ${event.type}`);
      }

      // 4. Salvar na Tabela de Auditoria (Sempre que o processamento acima não lançar erro)
      const { error: auditError } = await supabaseAdmin
        .from('stripe_events')
        .insert({
          stripe_event_id: eventId,
          stripe_event_type: event.type,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          stripe_session_id: stripeSessionId,
          user_id: userId,
          payload_json: event,
        });

      if (auditError) {
        console.error(`[${timestamp}] [StripeServerService] FAILED to log event to stripe_events:`, auditError.message);
      } else {
        console.log(`[${timestamp}] [StripeServerService] Event ${eventId} logged successfully.`);
      }

    } catch (processError: any) {
      console.error(`[${timestamp}] [StripeServerService] FATAL ERROR processing event ${eventId}:`, processError.message);
      throw processError; // O webhook handler retornará 400/500 e o Stripe tentará novamente
    }
  },

  /**
   * Utilitário para atualizar perfil no Supabase Admin.
   */
  async updateProfileSubscription(userId: string, updates: any) {
    console.log(`[StripeServerService] Starting Supabase update for userId: ${userId} with updates: ${JSON.stringify(updates)}`);
    
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select();

    console.log(`[StripeServerService] Supabase Raw Result - Data: ${JSON.stringify(data)}, Error: ${JSON.stringify(error)}`);

    if (error) {
      console.error(`[StripeServerService] SUPABASE UPDATE FAIL for profile ${userId}: ${error.message}`);
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn(`[StripeServerService] SUPABASE UPDATE WARNING: No profile found to update with ID ${userId}. Please check if profiles.id matches auth.users.id.`);
    } else {
      console.log(`[StripeServerService] SUPABASE UPDATE SUCCESS for profile ${userId}. Records updated: ${data.length}`);
    }

    return data;
  }
};
