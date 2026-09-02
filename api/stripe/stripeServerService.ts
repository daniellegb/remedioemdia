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

function getProjectRefFromUrl(url: string): string | null {
  try {
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    return match ? match[1] : null;
  } catch (e) {
    // Ignore parsing errors
  }
  return null;
}

// --- SUPABASE ADMIN ---
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY || '';

function getMatchingSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    return url;
  }
  throw new Error('[Supabase Config Error] URL HTTP/HTTPS do Supabase não configurada. Defina SUPABASE_URL ou VITE_SUPABASE_URL.');
}

const supabaseUrl = getMatchingSupabaseUrl();

if (!supabaseServiceKey) {
  console.error('[StripeServerService] Missing environment variable: SUPABASE_SECRET_KEY');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
   * Cria uma sessão de checkout no Stripe garantindo a identidade do usuário autenticado.
   */
  async createCheckoutSession(userIdOrProfile: string | Profile, userEmailOverride?: string): Promise<string> {
    const stripe = getStripe();

    let userId: string;
    let providedEmail: string | undefined;

    if (typeof userIdOrProfile === 'string') {
      userId = userIdOrProfile;
      providedEmail = userEmailOverride;
    } else {
      userId = userIdOrProfile.id;
      providedEmail = userIdOrProfile.email;
    }

    if (!userId) {
      throw new Error('ID de usuário é obrigatório para iniciar o checkout.');
    }

    // Fetch authenticated user from Supabase Auth to get the real email address
    let user: any = null;
    try {
      const { data, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (userError) {
        console.error('[StripeServerService] Error fetching user from auth:', userError.message);
      } else {
        user = data.user;
      }
    } catch (e: any) {
      console.error('[StripeServerService] Exception fetching user from auth:', e.message);
    }

    const realEmail = user?.email || providedEmail;

    // Buscar perfil no Supabase pelo userId autenticado
    const { data: dbProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    let stripeCustomerId = dbProfile?.stripe_customer_id;

    // Temporary debug logs
    console.log('[StripeServerService] Checkout session user validation:', {
      userId: user?.id || userId,
      userEmail: user?.email,
      realEmail,
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
      console.log(`[StripeServerService] Creating new Stripe customer for user ${userId} (${realEmail})`);
      const customer = await stripe.customers.create({
        email: realEmail || undefined,
        metadata: {
          userId: userId,
        },
      });
      stripeCustomerId = customer.id;

      // Salvar no Supabase usando Admin para o perfil autenticado
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (updateError) {
        console.error('[StripeServerService] Erro ao salvar stripe_customer_id no Supabase:', updateError.message);
        throw new Error('Falha ao vincular cliente Stripe ao perfil.');
      }
    }

    // 2. Criar checkout session
    let priceId = process.env.STRIPE_PRICE_ID || 'price_1TXRkOK6dW3wcsxW6lCAXqHR';
    if (!priceId || priceId === 'price_1TRZZ5K6dW3wcsxWccq9X1Gc') {
      priceId = 'price_1TXRkOK6dW3wcsxW6lCAXqHR';
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
        userId: userId,
      },
      subscription_data: {
        metadata: {
          userId: userId,
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
          
          let endsAt: string | null = null;
          let sub: any = null;
          if (stripeSubscriptionId) {
            try {
              sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
              endsAt = new Date(sub.current_period_end * 1000).toISOString();
              console.log(`[${timestamp}] [StripeServerService] Found current period end from webhook checkout retrieve: ${endsAt}`);
            } catch (err) {
              console.error('[StripeServerService] Error retrieving subscription during checkout fallback:', err);
            }
          }

          if (userId) {
            await this.updateProfileSubscription(userId, {
              plan: 'premium',
              subscription_status: 'active',
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: stripeSubscriptionId,
              subscription_ends_at: endsAt,
              trial_ends_at: null,
            });

            // HISTÓRICO: Criar registro ao criar assinatura
            if (stripeSubscriptionId) {
              const startedAt = sub?.start_date ? new Date(sub.start_date * 1000).toISOString() : (sub?.created ? new Date(sub.created * 1000).toISOString() : new Date().toISOString());
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: 'active',
                startedAt,
              });
            }
          } else {
            console.warn(`[${timestamp}] [StripeServerService] MISSING userId in metadata for session ${stripeSessionId}`);
          }
          break;
        }

        case 'customer.subscription.created': {
          const subscription = event.data.object as any;
          stripeCustomerId = subscription.customer as string;
          stripeSubscriptionId = subscription.id;

          const rawMetadataUserId = subscription.metadata?.userId;
          userId = (rawMetadataUserId && rawMetadataUserId !== 'null' && rawMetadataUserId !== '') ? (rawMetadataUserId as string) : null;

          const startedAt = subscription.start_date ? new Date(subscription.start_date * 1000).toISOString() : (subscription.created ? new Date(subscription.created * 1000).toISOString() : new Date().toISOString());

          if (!userId && stripeCustomerId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id')
              .eq('stripe_customer_id', stripeCustomerId)
              .maybeSingle();
            if (data) {
              userId = data.id;
            }
          }

          if (userId && stripeSubscriptionId) {
            await this.updateSubscriptionHistory({
              userId,
              stripeCustomerId,
              stripeSubscriptionId,
              status: 'active',
              startedAt,
            });
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          stripeSubscriptionId = invoice.subscription as string;
          stripeCustomerId = invoice.customer as string;
          
          if (!stripeSubscriptionId) break;

          const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
          
          const rawMetadataUserId = subscription.metadata?.userId;
          userId = (rawMetadataUserId && rawMetadataUserId !== 'null' && rawMetadataUserId !== '') ? (rawMetadataUserId as string) : null;

          const endsAt = new Date(subscription.current_period_end * 1000).toISOString();
          const updates = {
            subscription_status: 'active',
            subscription_ends_at: endsAt,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId,
          };

          if (userId) {
            await this.updateProfileSubscription(userId, updates);
          } else if (stripeCustomerId) {
            console.log(`[${timestamp}] [StripeServerService] Updating subscription on invoice payment using customer ID fallback: ${stripeCustomerId}`);
            const { data } = await supabaseAdmin
              .from('profiles')
              .update({
                ...updates,
                updated_at: new Date().toISOString(),
              })
              .eq('stripe_customer_id', stripeCustomerId)
              .select();

            if (data && data.length > 0) {
              userId = data[0].id;
            }
          }

          if (userId && stripeSubscriptionId) {
            const startedAt = subscription.start_date ? new Date(subscription.start_date * 1000).toISOString() : (subscription.created ? new Date(subscription.created * 1000).toISOString() : new Date().toISOString());
            await this.updateSubscriptionHistory({
              userId,
              stripeCustomerId,
              stripeSubscriptionId,
              status: 'active',
              startedAt,
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

          if (userId && stripeSubscriptionId) {
            await this.updateSubscriptionHistory({
              userId,
              stripeCustomerId,
              stripeSubscriptionId,
              status: 'ended',
              endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : new Date().toISOString(),
            });
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          stripeCustomerId = subscription.customer as string;
          stripeSubscriptionId = subscription.id;

          const rawMetadataUserId = subscription.metadata?.userId;
          userId = (rawMetadataUserId && rawMetadataUserId !== 'null' && rawMetadataUserId !== '') ? (rawMetadataUserId as string) : null;

          const endsAt = new Date(subscription.current_period_end * 1000).toISOString();
          let updates: any = {};

          if (subscription.cancel_at_period_end) {
            updates = {
              subscription_status: 'canceled',
              subscription_ends_at: endsAt,
            };
          } else if (subscription.status === 'active') {
            updates = {
              subscription_status: 'active',
              subscription_ends_at: endsAt,
            };
          }

          if (Object.keys(updates).length > 0) {
            if (userId) {
              console.log(`[${timestamp}] [StripeServerService] Updating subscription using Metadata User ID: ${userId}`);
              await this.updateProfileSubscription(userId, updates);
            } else if (stripeCustomerId) {
              console.log(`[${timestamp}] [StripeServerService] Updating subscription using Stripe Customer ID: ${stripeCustomerId}`);
              const { data, error } = await supabaseAdmin
                .from('profiles')
                .update({
                  ...updates,
                  updated_at: new Date().toISOString(),
                })
                .eq('stripe_customer_id', stripeCustomerId)
                .select();

              if (error) {
                console.error('supabase update failed inside customer.subscription.updated', { stripeCustomerId, error: error.message });
                throw error;
              }
              if (data && data.length > 0) {
                userId = data[0].id;
              }
            }
          }

          if (!userId && stripeCustomerId) {
            try {
              const { data: matchedProfile } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('stripe_customer_id', stripeCustomerId)
                .maybeSingle();
              if (matchedProfile) {
                userId = matchedProfile.id;
              }
            } catch (err) {
              console.error('[StripeServerService] Fallback user ID query failed:', err);
            }
          }

          if (userId && stripeSubscriptionId) {
            if (subscription.cancel_at_period_end) {
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: 'canceling',
                canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : new Date().toISOString(),
                accessExpiresAt: endsAt,
              });
            } else if (subscription.status === 'active') {
              const startedAt = subscription.start_date ? new Date(subscription.start_date * 1000).toISOString() : (subscription.created ? new Date(subscription.created * 1000).toISOString() : new Date().toISOString());
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: 'active',
                startedAt,
              });
            }

            // --- SPECIAL CASE: subscription reactivation after account deletion gets scheduled ---
            try {
              // 1. Fetch user profile db status
              const { data: profile, error: profileErr } = await supabaseAdmin
                .from('profiles')
                .select('account_status, scheduled_deletion_at')
                .eq('id', userId)
                .single();

              if (profileErr) {
                console.warn(`[StripeServerService] Profile fetch warning for reactivation sync: ${profileErr.message}`);
              }

              // 2. Fetch auth user metadata backup
              let authMeta: any = null;
              try {
                const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
                if (authUser?.user_metadata) {
                  authMeta = authUser.user_metadata;
                }
              } catch (metaErr: any) {
                console.error('[StripeServerService] Error fetching auth user for reactivation:', metaErr.message || metaErr);
              }

              const accountStatus = profile?.account_status || authMeta?.account_status || 'active';
              const originallyScheduledDeletionAt = profile?.scheduled_deletion_at || authMeta?.scheduled_deletion_at || null;

              const previousAttributes = (event.data as any).previous_attributes;

              const subscriptionReactivated =
                previousAttributes?.cancel_at_period_end === true &&
                subscription.cancel_at_period_end === false;

              // Required log: REACTIVATION CHECK
              console.log('REACTIVATION CHECK', {
                userId,
                accountStatus,
                previousAttributes,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
              });

              if (subscriptionReactivated && accountStatus === 'pending_deletion') {
                // Required log: AUTO CANCEL DELETION TRIGGERED
                console.log('AUTO CANCEL DELETION TRIGGERED');

                console.log(`[StripeServerService] subscription reactivated for user ${userId}. Auto-cancelling account deletion.`);

                // 1. Update profiles table
                const { error: profileUpdateErr } = await supabaseAdmin
                  .from('profiles')
                  .update({
                    account_status: 'active',
                    deletion_requested_at: null,
                    scheduled_deletion_at: null,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', userId);

                if (profileUpdateErr) {
                  console.warn(`[StripeServerService] Direct profiles table update failed during reactivation: ${profileUpdateErr.message}`);
                }

                // 2. Update auth metadata backup
                try {
                  await supabaseAdmin.auth.admin.updateUserById(userId, {
                    user_metadata: {
                      ...(authMeta || {}),
                      account_status: 'active',
                      deletion_requested_at: null,
                      scheduled_deletion_at: null,
                    },
                  });
                } catch (metaErr: any) {
                  console.error('[StripeServerService] Failed to update user_metadata during reactivation:', metaErr.message || metaErr);
                }

                // 3. Register Audit Log
                const auditType = 'ACCOUNT_DELETION_AUTO_CANCELLED_BY_SUBSCRIPTION_REACTIVATION';
                try {
                  const { error: auditErr } = await supabaseAdmin
                    .from('stripe_events')
                    .insert({
                      stripe_event_id: `reactivation-audit-${userId}-${Date.now()}`,
                      stripe_event_type: auditType,
                      stripe_customer_id: stripeCustomerId,
                      stripe_subscription_id: stripeSubscriptionId,
                      user_id: userId,
                      payload_json: {
                        event_type: auditType,
                        user_id: userId,
                        timestamp: new Date().toISOString(),
                        stripe_subscription_id: stripeSubscriptionId,
                        originally_scheduled_deletion_at: originallyScheduledDeletionAt,
                      },
                    });

                  if (auditErr) {
                    console.error(`[StripeServerService] FAILED to write reactivation audit log: ${auditErr.message}`);
                  } else {
                    console.log(`[StripeServerService] Audit logged: ${auditType}`);
                  }
                } catch (auditErr: any) {
                  console.error('[StripeServerService] Exception writing reactivation audit log:', auditErr.message || auditErr);
                }

                // 4. Notify the user
                try {
                  const { error: notifyErr } = await supabaseAdmin
                    .from('notification_queue')
                    .insert([{
                      user_id: userId,
                      title: 'Exclusão de Conta Cancelada 🔒',
                      body: 'Sua assinatura foi reativada e, por isso, o processo de exclusão da conta foi cancelado automaticamente. Caso ainda deseje excluir sua conta, será necessário solicitar a exclusão novamente.',
                      trigger_at: new Date().toISOString(),
                      sent: false,
                    }]);

                  if (notifyErr) {
                    console.error(`[StripeServerService] FAILED to schedule user notification: ${notifyErr.message}`);
                  } else {
                    console.log('[StripeServerService] Reactivation response notification queued successfully.');
                  }
                } catch (notifyErr: any) {
                  console.error('[StripeServerService] Exception queueing reactivation notification:', notifyErr.message || notifyErr);
                }
              }
            } catch (reactivationError: any) {
              console.error('[StripeServerService] Fatal error checking or executing deletion auto-cancel:', reactivationError.message || reactivationError);
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
   * Cria uma sessão de portal de faturamento do Stripe para o cliente gerenciar assinaturas.
   */
  async createPortalSession(profile: Profile, returnUrl: string): Promise<string> {
    const stripe = getStripe();
    const stripeCustomerId = profile.stripe_customer_id;

    if (!stripeCustomerId) {
      throw new Error('Nenhuma assinatura encontrada.');
    }

    // Valida se o cliente de fato existe no Stripe
    try {
      console.log(`[StripeServerService] Verifying existing Stripe customer for portal: ${stripeCustomerId}`);
      const customer = await stripe.customers.retrieve(stripeCustomerId);
      if (customer.deleted) {
        throw new Error('Nenhuma assinatura encontrada.');
      }
    } catch (err: any) {
      if (err?.code === 'resource_missing' || err?.statusCode === 404 || err?.message?.includes('No such customer')) {
        throw new Error('Nenhuma assinatura encontrada.');
      }
      throw err;
    }

    console.log(`[StripeServerService] Creating Stripe billing portal session for customer ${stripeCustomerId}`);
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return session.url;
  },

  /**
   * Sincroniza o status da assinatura do usuário diretamente com a API do Stripe do backend.
   * Útil para curar/atualizar instantaneamente dados divergentes ou desatualizados.
   */
  async syncSubscription(userId: string): Promise<Profile> {
    const activeRef = getProjectRefFromUrl(supabaseUrl);
    const viteRef = getProjectRefFromUrl(process.env.VITE_SUPABASE_URL || '');
    if (viteRef && activeRef && viteRef !== activeRef) {
      console.error(`[SUPABASE CONFIG MISMATCH] O frontend está configurado com o projeto: "${viteRef}" mas o backend está com: "${activeRef}".`);
      throw new Error(`Conexão Supabase inconsistente: o frontend está em "${viteRef}" enquanto o backend está em "${activeRef}". Por favor, atualize as credenciais no menu Settings do AI Studio.`);
    }

    let { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.log(`[StripeServerService] Perfil para o id ${userId} não encontrado para sincronização. Tentando criar um perfil padrão...`);
      try {
        const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (authError || !authUser) {
          throw new Error('Usuário de autenticação não encontrado no Supabase: ' + (authError?.message || 'id inexistente'));
        }

        const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'Usuário';

        const newProfile = {
          id: userId,
          name: name
        };

        const { data: insertedProfile, error: insertError } = await supabaseAdmin
          .from('profiles')
          .insert([newProfile])
          .select()
          .single();

        if (insertError) {
          console.error('[StripeServerService] Erro ao inserir perfil padrão:', insertError.message);
          throw new Error('Não foi possível criar o perfil no banco de dados para o usuário: ' + insertError.message);
        }

        profile = insertedProfile;
      } catch (err: any) {
        console.error('[StripeServerService] Falha ao recuperar/criar perfil padrão:', err.message || err);
        throw new Error('Perfil não encontrado para sincronização: ' + (err.message || err));
      }
    }

    const stripeCustomerId = profile.stripe_customer_id;
    if (!stripeCustomerId) {
      console.log('[StripeServerService] Sincronização ignorada: sem stripe_customer_id.');
      return profile as Profile;
    }

    const stripe = getStripe();
    try {
      console.log(`[StripeServerService] Sincronizando dados Stripe para o cliente: ${stripeCustomerId}`);
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'all',
        limit: 1,
      });

      if (subscriptions.data.length > 0) {
        const subscription = subscriptions.data[0] as any;
        const endsAt = new Date(subscription.current_period_end * 1000).toISOString();
        const status = subscription.cancel_at_period_end ? 'canceled' : subscription.status;

        const updates: any = {
          subscription_status: status,
          subscription_ends_at: endsAt,
          stripe_subscription_id: subscription.id,
          plan: (subscription.status === 'active' || subscription.status === 'trialing' || (subscription.status === 'canceled' && new Date() < new Date(subscription.current_period_end * 1000))) ? 'premium' : 'free',
        };

        // --- SPECIAL CASE: subscription reactivation after account deletion gets scheduled ---
        let autoCancelledDeletion = false;
        let authMeta: any = null;
        let originallyScheduledDeletionAt: string | null = null;

        try {
          // Fetch auth user metadata backup
          const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
          if (authUser?.user_metadata) {
            authMeta = authUser.user_metadata;
          }
        } catch (metaErr: any) {
          console.error('[StripeServerService-Sync] Error fetching auth user for reactivation:', metaErr.message || metaErr);
        }

        const accountStatus = profile.account_status || authMeta?.account_status || 'active';
        originallyScheduledDeletionAt = profile.scheduled_deletion_at || authMeta?.scheduled_deletion_at || null;

        if (!subscription.cancel_at_period_end && subscription.status === 'active' && accountStatus === 'pending_deletion') {
          console.log(`[StripeServerService-Sync] subscription reactivated for user ${userId}. Auto-cancelling account deletion.`);
          updates.account_status = 'active';
          updates.deletion_requested_at = null;
          updates.scheduled_deletion_at = null;
          autoCancelledDeletion = true;
        }

        console.log(`[StripeServerService] Atualizando dados locais de faturamento via sincronização:`, updates);
        const { data: updatedProfile, error: updateError } = await supabaseAdmin
          .from('profiles')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)
          .select()
          .single();

        if (updateError) {
          console.error('[StripeServerService] Falha ao atualizar perfil pós sincronização Stripe:', updateError.message);
          return profile as Profile;
        }

        if (autoCancelledDeletion) {
          // 1. Update auth metadata backup
          try {
            await supabaseAdmin.auth.admin.updateUserById(userId, {
              user_metadata: {
                ...(authMeta || {}),
                account_status: 'active',
                deletion_requested_at: null,
                scheduled_deletion_at: null,
              },
            });
          } catch (metaErr: any) {
            console.error('[StripeServerService-Sync] Failed to update user_metadata during reactivation sync:', metaErr.message || metaErr);
          }

          // 2. Register Audit Log
          const auditType = 'ACCOUNT_DELETION_AUTO_CANCELLED_BY_SUBSCRIPTION_REACTIVATION';
          try {
            const { error: auditErr } = await supabaseAdmin
              .from('stripe_events')
              .insert({
                stripe_event_id: `reactivation-sync-audit-${userId}-${Date.now()}`,
                stripe_event_type: auditType,
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: subscription.id,
                user_id: userId,
                payload_json: {
                  event_type: auditType,
                  user_id: userId,
                  timestamp: new Date().toISOString(),
                  stripe_subscription_id: subscription.id,
                  originally_scheduled_deletion_at: originallyScheduledDeletionAt,
                  source: 'sync'
                },
              });

            if (auditErr) {
              console.error(`[StripeServerService-Sync] FAILED to write reactivation audit log: ${auditErr.message}`);
            } else {
              console.log(`[StripeServerService-Sync] Audit logged: ${auditType}`);
            }
          } catch (auditErr: any) {
            console.error('[StripeServerService-Sync] Exception writing reactivation audit log:', auditErr.message || auditErr);
          }

          // 3. Notify the user
          try {
            const { error: notifyErr } = await supabaseAdmin
              .from('notification_queue')
              .insert([{
                user_id: userId,
                title: 'Exclusão de Conta Cancelada 🔒',
                body: 'Sua assinatura foi reativada e, por isso, o processo de exclusão da conta foi cancelado automaticamente. Caso ainda deseje excluir sua conta, será necessário solicitar a exclusão novamente.',
                trigger_at: new Date().toISOString(),
                sent: false,
              }]);

            if (notifyErr) {
              console.error(`[StripeServerService-Sync] FAILED to schedule user notification: ${notifyErr.message}`);
            } else {
              console.log('[StripeServerService-Sync] Reactivation response notification queued successfully.');
            }
          } catch (notifyErr: any) {
            console.error('[StripeServerService-Sync] Exception queueing reactivation notification:', notifyErr.message || notifyErr);
          }
        }

        // HISTÓRICO: Sincronizar histórico local também
        const historyStatus = subscription.cancel_at_period_end ? 'canceling' : (subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : 'ended');
        const startedAt = subscription.start_date ? new Date(subscription.start_date * 1000).toISOString() : (subscription.created ? new Date(subscription.created * 1000).toISOString() : new Date().toISOString());

        await this.updateSubscriptionHistory({
          userId,
          stripeCustomerId,
          stripeSubscriptionId: subscription.id,
          status: historyStatus,
          startedAt,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : undefined,
          accessExpiresAt: endsAt,
          endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : undefined,
        });

        return updatedProfile as Profile;
      }
    } catch (err) {
      console.error('[StripeServerService] Erro inesperado durante sincronização de assinatura com o Stripe:', err);
    }

    return profile as Profile;
  },

  /**
   * Mantém o histórico do ciclo Premium do usuário na tabela `stripe_subscription_history`.
   */
  async updateSubscriptionHistory(params: {
    userId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string;
    status: 'active' | 'canceling' | 'ended';
    startedAt?: string;
    canceledAt?: string;
    accessExpiresAt?: string;
    endedAt?: string;
  }) {
    const {
      userId,
      stripeCustomerId,
      stripeSubscriptionId,
      status,
      startedAt,
      canceledAt,
      accessExpiresAt,
      endedAt,
    } = params;

    if (!userId || !stripeSubscriptionId) {
      console.warn('[StripeServerService] Skipping subscription history write: userId or stripeSubscriptionId missing', { userId, stripeSubscriptionId });
      return;
    }

    try {
      console.log(`[StripeServerService] Updating subscription history: sub=${stripeSubscriptionId}, status=${status}, user=${userId}`);

      // Vamos tentar buscar se já existe para saber quais campos preservar e evitar subescrever com nulls
      const { data: existingRecord, error: fetchError } = await supabaseAdmin
        .from('stripe_subscription_history')
        .select('*')
        .eq('stripe_subscription_id', stripeSubscriptionId)
        .maybeSingle();

      if (fetchError) {
        console.error('[StripeServerService] Error fetching existing subscription history:', fetchError.message);
      }

      const dbUpdates: any = {
        user_id: userId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        status,
        updated_at: new Date().toISOString(),
      };

      // Controlar preenchimento condicional de datas
      if (status === 'active') {
        if (startedAt) {
          dbUpdates.started_at = startedAt;
        } else if (!existingRecord?.started_at) {
          dbUpdates.started_at = new Date().toISOString();
        }
        // Se já existia valor de access_expires_at, mantém ou atualiza para manter consistência
        if (accessExpiresAt) {
          dbUpdates.access_expires_at = accessExpiresAt;
        }
      }

      if (status === 'canceling') {
        dbUpdates.canceled_at = canceledAt || new Date().toISOString();
        if (accessExpiresAt) {
          dbUpdates.access_expires_at = accessExpiresAt;
        }
        if (existingRecord?.started_at) {
          dbUpdates.started_at = existingRecord.started_at;
        }
      }

      if (status === 'ended') {
        dbUpdates.ended_at = endedAt || new Date().toISOString();
        if (accessExpiresAt) {
          dbUpdates.access_expires_at = accessExpiresAt;
        } else if (existingRecord && !existingRecord.access_expires_at) {
          dbUpdates.access_expires_at = dbUpdates.ended_at;
        } else if (existingRecord?.access_expires_at) {
          dbUpdates.access_expires_at = existingRecord.access_expires_at;
        }
        if (existingRecord?.started_at) {
          dbUpdates.started_at = existingRecord.started_at;
        }
        if (existingRecord?.canceled_at) {
          dbUpdates.canceled_at = existingRecord.canceled_at;
        }
      }

      console.log('[StripeServerService] Upserting subscription history record with:', dbUpdates);

      const { error: upsertError } = await supabaseAdmin
        .from('stripe_subscription_history')
        .upsert(dbUpdates, { onConflict: 'stripe_subscription_id' });

      if (upsertError) {
        console.error('[StripeServerService] Error upserting subscription history:', upsertError.message);
      } else {
        console.log('[StripeServerService] Subscription history upserted successfully!');
      }
    } catch (err: any) {
      console.error('[StripeServerService] Exception in updateSubscriptionHistory:', err.message);
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
