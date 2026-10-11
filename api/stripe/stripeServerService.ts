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

function extractStripeSubscriptionStartedAt(subscription: any): string | null {
  const rawTimestamp = subscription?.start_date ?? subscription?.created;
  if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp) && rawTimestamp > 0) {
    return new Date(rawTimestamp * 1000).toISOString();
  }
  return null;
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
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      throw new Error('STRIPE_PRICE_ID environment variable is required');
    }

    const defaultUrl = (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production')
      ? 'https://app.remedioemdia.com'
      : 'https://dev.remedioemdia.com';
    const appUrl = process.env.APP_URL || defaultUrl;

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      payment_method_collection: 'if_required',
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
   * Cria uma sessão de checkout no Stripe para um novo visitante (guest).
   */
  async createGuestCheckoutSession(guestEmail: string, legalAcceptanceAt: string): Promise<string> {
    const stripe = getStripe();

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      throw new Error('STRIPE_PRICE_ID environment variable is required');
    }

    const defaultUrl = (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production')
      ? 'https://app.remedioemdia.com'
      : 'https://dev.remedioemdia.com';
    const appUrl = process.env.APP_URL || defaultUrl;

    const session = await stripe.checkout.sessions.create({
      customer_email: guestEmail,
      mode: 'subscription',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      payment_method_collection: 'if_required',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/subscription/success`,
      cancel_url: `${appUrl}/subscription/cancel`,
      metadata: {
        is_guest: 'true',
        legal_acceptance_at: legalAcceptanceAt,
      },
      subscription_data: {
        metadata: {
          is_guest: 'true',
          legal_acceptance_at: legalAcceptanceAt,
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
          const isGuest = session.metadata?.is_guest === 'true';
          const legalAcceptanceAt = session.metadata?.legal_acceptance_at;
          stripeCustomerId = session.customer as string;
          stripeSubscriptionId = session.subscription as string;
          stripeSessionId = session.id;

          console.log(`[${timestamp}] [StripeServerService] Processing Checkout Completed (User: ${userId}, Guest: ${isGuest})`);
          
          let endsAt: string | null = null;
          let sub: any = null;
          let checkoutSubRetrieveFailed = false;
          if (stripeSubscriptionId) {
            try {
              sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
              const currentPeriodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
              const isSubCanceled =
                sub.status === 'canceled' ||
                sub.status === 'incomplete_expired' ||
                Boolean(sub.ended_at);
              const isSubEligible =
                (sub.status === 'active' || sub.status === 'trialing') &&
                !isSubCanceled;
              endsAt = isSubEligible && currentPeriodEnd
                ? new Date(currentPeriodEnd * 1000).toISOString()
                : null;
              console.log(`[${timestamp}] [StripeServerService] Found current period end from webhook checkout retrieve: ${endsAt}`);
            } catch (err) {
              checkoutSubRetrieveFailed = true;
              console.error('[StripeServerService] Error retrieving subscription during checkout fallback:', err);
            }
          }

          // TRATAMENTO PARA GUEST: Se não há userId mas is_guest === 'true', criar/localizar usuário no Supabase
          if (!userId && isGuest) {
            const guestEmail = (session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
            if (guestEmail) {
              console.log(`[${timestamp}] [StripeServerService] Processing Guest Checkout for email: ${guestEmail}`);

              // 1. Verificar se o usuário já existe no Supabase (perfis ou auth)
              const { data: existingProfile } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .ilike('email', guestEmail)
                .maybeSingle();

              if (existingProfile?.id) {
                userId = existingProfile.id;
                console.log(`[${timestamp}] [StripeServerService] Guest email belongs to existing profile ID: ${userId}`);
              } else {
                const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
                const existingAuthUser = (authUsers as any[])?.find((u: any) => u.email?.toLowerCase() === guestEmail);

                if (existingAuthUser?.id) {
                  userId = existingAuthUser.id;
                  console.log(`[${timestamp}] [StripeServerService] Guest email belongs to existing Auth user ID: ${userId}`);
                } else {
                  // 2. Convidar novo usuário no Supabase Auth via inviteUserByEmail
                  const defaultUrl = (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production')
                    ? 'https://app.remedioemdia.com'
                    : 'https://dev.remedioemdia.com';
                  const appUrl = process.env.APP_URL || defaultUrl;

                  console.log(`[${timestamp}] [StripeServerService] Inviting new Supabase Auth user for guest: ${guestEmail}`);
                  const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(guestEmail, {
                    redirectTo: `${appUrl}/reset-password`,
                    data: {
                      legal_acceptance_at: session.metadata?.legal_acceptance_at
                    }
                  });

                  if (inviteError) {
                    console.error(`[${timestamp}] [StripeServerService] Failed to invite Supabase user for guest ${guestEmail}:`, inviteError.message);
                    throw new Error(`Falha ao convidar usuário Supabase para o guest ${guestEmail}: ${inviteError.message}`);
                  }

                  if (inviteData?.user?.id) {
                    userId = inviteData.user.id;
                    console.log(`[${timestamp}] [StripeServerService] Successfully invited Supabase user ID: ${userId} for guest ${guestEmail}`);
                  }
                }
              }
            } else {
              console.warn(`[${timestamp}] [StripeServerService] Guest checkout session ${stripeSessionId} has no email address`);
            }
          }

          if (userId) {
            if (stripeSubscriptionId && (checkoutSubRetrieveFailed || !sub)) {
              throw new Error(
                `[StripeServerService] Cannot confirm subscription ${stripeSubscriptionId} state in Stripe during checkout.session.completed`
              );
            }

            const isSubTerminatedInStripe = Boolean(
              sub &&
              (sub.status === 'canceled' ||
                sub.status === 'incomplete_expired' ||
                Boolean(sub.ended_at))
            );
            const isSubEligibleInStripe = Boolean(
              sub &&
              (sub.status === 'active' || sub.status === 'trialing') &&
              !isSubTerminatedInStripe
            );
            const isAlreadyTerminatedInDb = stripeSubscriptionId
              ? await this.hasSubscriptionTerminationEvidence(stripeSubscriptionId)
              : false;
            const startedAt = extractStripeSubscriptionStartedAt(sub);

            if (isAlreadyTerminatedInDb || !isSubEligibleInStripe) {
              console.warn(
                `[${timestamp}] [StripeServerService] Skipping Premium activation in checkout.session.completed for sub ${stripeSubscriptionId} (isAlreadyTerminatedInDb=${isAlreadyTerminatedInDb}, status=${sub?.status})`
              );
              if (isSubTerminatedInStripe && !isAlreadyTerminatedInDb && stripeSubscriptionId) {
                const endedAtIso = sub?.ended_at
                  ? new Date(sub.ended_at * 1000).toISOString()
                  : new Date().toISOString();
                await this.updateSubscriptionHistory({
                  userId,
                  stripeCustomerId,
                  stripeSubscriptionId,
                  status: 'ended',
                  startedAt: startedAt ?? undefined,
                  canceledAt: sub?.canceled_at
                    ? new Date(sub.canceled_at * 1000).toISOString()
                    : undefined,
                  endedAt: endedAtIso,
                  accessExpiresAt: endedAtIso,
                });
              }
            } else {
              const updatedRows = await this.updateProfileSubscription(
                userId,
                {
                  plan: 'premium',
                  subscription_status: sub?.cancel_at_period_end ? 'canceled' : 'active',
                  stripe_customer_id: stripeCustomerId,
                  stripe_subscription_id: stripeSubscriptionId,
                  subscription_ends_at: endsAt,
                  trial_ends_at: null,
                  legal_acceptance_at: legalAcceptanceAt,
                },
                {
                  eventSubscriptionId: stripeSubscriptionId,
                  isEligibleForPremium: true,
                  isCanceledAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
                  incomingStartedAt: startedAt,
                  isCheckoutCompletion: true,
                  verifiedInStripe: true,
                }
              );

              const profileUpdateApplied = Array.isArray(updatedRows) && updatedRows.length > 0;

              // HISTÓRICO: Criar/atualizar registro ao concluir checkout elegível
              if (stripeSubscriptionId && profileUpdateApplied) {
                await this.updateSubscriptionHistory({
                  userId,
                  stripeCustomerId,
                  stripeSubscriptionId,
                  status: sub?.cancel_at_period_end ? 'canceling' : 'active',
                  startedAt: startedAt ?? undefined,
                  canceledAt: sub?.canceled_at
                    ? new Date(sub.canceled_at * 1000).toISOString()
                    : undefined,
                  accessExpiresAt: endsAt ?? undefined,
                  allowReactivationFromCanceling: false,
                });
              }
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

          const startedAt = extractStripeSubscriptionStartedAt(subscription);

          const isEffectivelyCanceled =
            subscription.status === 'canceled' ||
            subscription.status === 'incomplete_expired' ||
            Boolean(subscription.ended_at);
          const isEligibleForPremium =
            (subscription.status === 'active' || subscription.status === 'trialing') &&
            !isEffectivelyCanceled;

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

          if (userId && stripeSubscriptionId && isEligibleForPremium) {
            const isAlreadyTerminated = await this.hasSubscriptionTerminationEvidence(stripeSubscriptionId);
            if (!isAlreadyTerminated) {
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: subscription.cancel_at_period_end ? 'canceling' : 'active',
                startedAt: startedAt ?? undefined,
                canceledAt: subscription.canceled_at
                  ? new Date(subscription.canceled_at * 1000).toISOString()
                  : undefined,
                allowReactivationFromCanceling: false,
              });
            }
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

          const isEffectivelyCanceled =
            subscription.status === 'canceled' ||
            subscription.status === 'incomplete_expired' ||
            Boolean(subscription.ended_at);
          const currentPeriodEnd = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
          const isEligibleForPremium =
            (subscription.status === 'active' || subscription.status === 'trialing') &&
            !isEffectivelyCanceled;
          const endsAt = isEligibleForPremium && currentPeriodEnd
            ? new Date(currentPeriodEnd * 1000).toISOString()
            : null;
          const startedAt = extractStripeSubscriptionStartedAt(subscription);

          let targetProfile: any = null;
          if (userId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, plan, subscription_status, stripe_subscription_id')
              .eq('id', userId)
              .maybeSingle();
            targetProfile = data;
          }
          if (!targetProfile && stripeCustomerId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, plan, subscription_status, stripe_subscription_id')
              .eq('stripe_customer_id', stripeCustomerId)
              .maybeSingle();
            if (data) {
              targetProfile = data;
              userId = data.id;
            }
          }
          if (!targetProfile && stripeSubscriptionId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, plan, subscription_status, stripe_subscription_id')
              .eq('stripe_subscription_id', stripeSubscriptionId)
              .maybeSingle();
            if (data) {
              targetProfile = data;
              userId = data.id;
            }
          }

          const isAlreadyTerminated = await this.hasSubscriptionTerminationEvidence(stripeSubscriptionId);
          if (isAlreadyTerminated || !isEligibleForPremium) {
            console.warn(
              `[${timestamp}] [StripeServerService] Ignoring invoice.payment_succeeded for subscription ${stripeSubscriptionId} (isAlreadyTerminated=${isAlreadyTerminated}, status=${subscription.status}, ended_at=${subscription.ended_at})`
            );
            if (isEffectivelyCanceled && !isAlreadyTerminated && userId) {
              const endedAtIso = subscription.ended_at
                ? new Date(subscription.ended_at * 1000).toISOString()
                : new Date().toISOString();
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: 'ended',
                startedAt: startedAt ?? undefined,
                canceledAt: subscription.canceled_at
                  ? new Date(subscription.canceled_at * 1000).toISOString()
                  : undefined,
                endedAt: endedAtIso,
                accessExpiresAt: endedAtIso,
              });
            }
            break;
          }

          const updates = {
            plan: 'premium',
            subscription_status: subscription.cancel_at_period_end ? 'canceled' : 'active',
            subscription_ends_at: endsAt,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId,
          };

          if (userId) {
            await this.updateProfileSubscription(userId, updates, {
              eventSubscriptionId: stripeSubscriptionId,
              isEligibleForPremium: true,
              isCanceledAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
              incomingStartedAt: startedAt,
              verifiedInStripe: true,
            });

            await this.updateSubscriptionHistory({
              userId,
              stripeCustomerId,
              stripeSubscriptionId,
              status: subscription.cancel_at_period_end ? 'canceling' : 'active',
              startedAt: startedAt ?? undefined,
              canceledAt: subscription.canceled_at
                ? new Date(subscription.canceled_at * 1000).toISOString()
                : undefined,
              accessExpiresAt: endsAt ?? undefined,
              allowReactivationFromCanceling: false,
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
            subscription_ends_at: null,
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          };

          let targetProfile: any = null;
          if (userId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, stripe_subscription_id')
              .eq('id', userId)
              .maybeSingle();
            targetProfile = data;
          }
          if (!targetProfile && stripeCustomerId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, stripe_subscription_id')
              .eq('stripe_customer_id', stripeCustomerId)
              .maybeSingle();
            if (data) {
              targetProfile = data;
              userId = data.id;
            }
          }
          if (!targetProfile && stripeSubscriptionId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, stripe_subscription_id')
              .eq('stripe_subscription_id', stripeSubscriptionId)
              .maybeSingle();
            if (data) {
              targetProfile = data;
              userId = data.id;
            }
          }

          const isAssociatedWithDifferentSub = Boolean(
            targetProfile?.stripe_subscription_id &&
            stripeSubscriptionId &&
            targetProfile.stripe_subscription_id !== stripeSubscriptionId
          );

          if (isAssociatedWithDifferentSub) {
            console.warn(
              `[${timestamp}] [StripeServerService] Ignoring profile downgrade on customer.subscription.deleted for sub ${stripeSubscriptionId} because profile ${userId} is associated with subscription ${targetProfile.stripe_subscription_id}`
            );
          } else if (userId) {
            console.log(`[${timestamp}] [StripeServerService] Downgrading subscription for User ID: ${userId}`);
            await this.updateProfileSubscription(userId, updates, {
              eventSubscriptionId: stripeSubscriptionId,
              isEligibleForPremium: false,
            });
          } else {
            console.warn(
              `[${timestamp}] [StripeServerService] No profile found to downgrade on customer.subscription.deleted (customer=${stripeCustomerId}, sub=${stripeSubscriptionId}).`
            );
          }

          if (userId && stripeSubscriptionId) {
            const endedAtIso = subscription.ended_at
              ? new Date(subscription.ended_at * 1000).toISOString()
              : new Date().toISOString();
            await this.updateSubscriptionHistory({
              userId,
              stripeCustomerId,
              stripeSubscriptionId,
              status: 'ended',
              endedAt: endedAtIso,
              accessExpiresAt: endedAtIso,
            });
          }
          break;
        }

        case 'customer.subscription.updated': {
          const eventSubscription = event.data.object as any;
          stripeCustomerId = eventSubscription.customer as string;
          stripeSubscriptionId = eventSubscription.id;

          const rawMetadataUserId = eventSubscription.metadata?.userId;
          userId = (rawMetadataUserId && rawMetadataUserId !== 'null' && rawMetadataUserId !== '') ? (rawMetadataUserId as string) : null;

          const isSnapshotTerminallyCanceled =
            eventSubscription.status === 'canceled' ||
            eventSubscription.status === 'incomplete_expired' ||
            Boolean(eventSubscription.ended_at);

          let subscription: any = eventSubscription;
          let confirmedInStripe = false;
          if (stripeSubscriptionId) {
            try {
              subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
              confirmedInStripe = true;
              if (!userId) {
                const liveMetaUserId = subscription.metadata?.userId;
                if (liveMetaUserId && liveMetaUserId !== 'null' && liveMetaUserId !== '') {
                  userId = liveMetaUserId as string;
                }
              }
            } catch (retrieveErr: any) {
              console.error(
                `[${timestamp}] [StripeServerService] Failed to retrieve live subscription ${stripeSubscriptionId} during customer.subscription.updated:`,
                retrieveErr?.message || retrieveErr
              );
              if (!isSnapshotTerminallyCanceled) {
                console.warn(
                  `[${timestamp}] [StripeServerService] Aborting sensitive customer.subscription.updated processing for ${stripeSubscriptionId} because live state could not be confirmed in Stripe.`
                );
                break;
              }
            }
          }

          const isEffectivelyCanceled =
            subscription.status === 'canceled' ||
            subscription.status === 'incomplete_expired' ||
            Boolean(subscription.ended_at);
          const currentPeriodEnd = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
          const isEligibleForPremium =
            confirmedInStripe &&
            (subscription.status === 'active' || subscription.status === 'trialing') &&
            !isEffectivelyCanceled;
          const endsAt = isEligibleForPremium && currentPeriodEnd
            ? new Date(currentPeriodEnd * 1000).toISOString()
            : null;

          let isAlreadyTerminated = false;
          if (stripeSubscriptionId && !isEffectivelyCanceled) {
            isAlreadyTerminated = await this.hasSubscriptionTerminationEvidence(stripeSubscriptionId);
            if (isAlreadyTerminated) {
              console.warn(`[${timestamp}] [StripeServerService] Ignoring out-of-order customer.subscription.updated for already terminated subscription ${stripeSubscriptionId}`);
            }
          }

          let targetProfile: any = null;
          if (userId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, plan, stripe_subscription_id, subscription_status, account_status, scheduled_deletion_at')
              .eq('id', userId)
              .maybeSingle();
            targetProfile = data;
          }
          if (!targetProfile && stripeCustomerId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, plan, stripe_subscription_id, subscription_status, account_status, scheduled_deletion_at')
              .eq('stripe_customer_id', stripeCustomerId)
              .maybeSingle();
            if (data) {
              targetProfile = data;
              userId = data.id;
            }
          }
          if (!targetProfile && stripeSubscriptionId) {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('id, plan, stripe_subscription_id, subscription_status, account_status, scheduled_deletion_at')
              .eq('stripe_subscription_id', stripeSubscriptionId)
              .maybeSingle();
            if (data) {
              targetProfile = data;
              userId = data.id;
            }
          }

          const startedAt = extractStripeSubscriptionStartedAt(subscription);

          let shouldSkipProfileUpdateForDifferentSub = false;
          if (targetProfile?.stripe_subscription_id && stripeSubscriptionId && targetProfile.stripe_subscription_id !== stripeSubscriptionId) {
            const currentBoundSubId = targetProfile.stripe_subscription_id;
            const canReplace = await this.canReplaceBoundSubscription({
              targetProfile,
              currentBoundSubId,
              incomingSubId: stripeSubscriptionId,
              isEligibleForPremium,
              isCanceledAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
              incomingStartedAt: startedAt,
              isCheckoutCompletion: false,
              verifiedInStripe: confirmedInStripe,
            });

            if (!canReplace) {
              shouldSkipProfileUpdateForDifferentSub = true;
              console.warn(
                `[${timestamp}] [StripeServerService] Ignoring customer.subscription.updated (${subscription.status}) for sub ${stripeSubscriptionId} because profile ${userId} is bound to subscription ${currentBoundSubId}`
              );
            }
          }

          let updates: any = {};

          if (!isAlreadyTerminated && !shouldSkipProfileUpdateForDifferentSub) {
            if (isEffectivelyCanceled) {
              updates = {
                plan: 'free',
                subscription_status: 'canceled',
                subscription_ends_at: null,
                stripe_subscription_id: null,
              };
            } else if (isEligibleForPremium && subscription.cancel_at_period_end) {
              updates = {
                plan: 'premium',
                subscription_status: 'canceled',
                subscription_ends_at: endsAt,
                stripe_subscription_id: stripeSubscriptionId,
              };
            } else if (isEligibleForPremium) {
              updates = {
                plan: 'premium',
                subscription_status: 'active',
                subscription_ends_at: endsAt,
                stripe_subscription_id: stripeSubscriptionId,
              };
            } else {
              updates = {
                plan: 'free',
                subscription_status: subscription.cancel_at_period_end
                  ? 'canceled'
                  : (targetProfile?.subscription_status === 'trial' ? 'trial' : 'expired'),
                subscription_ends_at: null,
                stripe_subscription_id:
                  targetProfile?.stripe_subscription_id === stripeSubscriptionId
                    ? stripeSubscriptionId
                    : null,
              };
            }
          }

          let profileUpdateApplied = false;
          if (Object.keys(updates).length > 0 && userId) {
            console.log(`[${timestamp}] [StripeServerService] Updating subscription using User ID: ${userId}`);
            const updatedRows = await this.updateProfileSubscription(userId, updates, {
              eventSubscriptionId: stripeSubscriptionId,
              isEligibleForPremium,
              isCanceledAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
              incomingStartedAt: startedAt,
              verifiedInStripe: confirmedInStripe,
            });
            profileUpdateApplied = Array.isArray(updatedRows) && updatedRows.length > 0;
          }

          if (userId && stripeSubscriptionId && !isAlreadyTerminated) {
            if (isEffectivelyCanceled) {
              const endedAtIso = subscription.ended_at
                ? new Date(subscription.ended_at * 1000).toISOString()
                : new Date().toISOString();
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: 'ended',
                startedAt: startedAt ?? undefined,
                canceledAt: subscription.canceled_at
                  ? new Date(subscription.canceled_at * 1000).toISOString()
                  : undefined,
                endedAt: endedAtIso,
                accessExpiresAt: endedAtIso,
              });
            } else if (isEligibleForPremium && subscription.cancel_at_period_end) {
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: 'canceling',
                startedAt: startedAt ?? undefined,
                canceledAt: subscription.canceled_at
                  ? new Date(subscription.canceled_at * 1000).toISOString()
                  : undefined,
                accessExpiresAt: endsAt ?? undefined,
                allowReactivationFromCanceling: false,
              });
            } else if (profileUpdateApplied && !shouldSkipProfileUpdateForDifferentSub && isEligibleForPremium) {
              await this.updateSubscriptionHistory({
                userId,
                stripeCustomerId,
                stripeSubscriptionId,
                status: 'active',
                startedAt: startedAt ?? undefined,
                accessExpiresAt: endsAt ?? undefined,
                allowReactivationFromCanceling: confirmedInStripe && !subscription.cancel_at_period_end,
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
                confirmedInStripe &&
                profileUpdateApplied &&
                !shouldSkipProfileUpdateForDifferentSub &&
                isEligibleForPremium &&
                previousAttributes?.cancel_at_period_end === true &&
                eventSubscription.cancel_at_period_end === false &&
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
        limit: 10,
      });

      if (subscriptions.data.length > 0) {
        const isSubEligibleInStripe = (s: any) =>
          Boolean(s) &&
          (s.status === 'active' || s.status === 'trialing') &&
          s.status !== 'canceled' &&
          s.status !== 'incomplete_expired' &&
          !s.ended_at;

        const eligibleSubs: any[] = [];
        for (const s of subscriptions.data) {
          if (isSubEligibleInStripe(s)) {
            const terminatedInDb = await this.hasSubscriptionTerminationEvidence(s.id);
            if (!terminatedInDb) {
              eligibleSubs.push(s);
            }
          }
        }

        const currentBoundSubId: string | null = profile.stripe_subscription_id || null;
        let boundSub: any = currentBoundSubId
          ? subscriptions.data.find((s: any) => s.id === currentBoundSubId)
          : undefined;

        if (currentBoundSubId && !boundSub) {
          try {
            boundSub = await stripe.subscriptions.retrieve(currentBoundSubId);
          } catch (retrieveBoundErr: any) {
            console.warn(
              `[StripeServerService-Sync] Não foi possível consultar a assinatura vinculada ${currentBoundSubId} diretamente na Stripe:`,
              retrieveBoundErr?.message || retrieveBoundErr
            );
          }
        }

        if (
          boundSub &&
          (boundSub.status === 'canceled' ||
            boundSub.status === 'incomplete_expired' ||
            Boolean(boundSub.ended_at))
        ) {
          const boundEndedAtIso = boundSub.ended_at
            ? new Date(boundSub.ended_at * 1000).toISOString()
            : new Date().toISOString();
          await this.updateSubscriptionHistory({
            userId,
            stripeCustomerId,
            stripeSubscriptionId: boundSub.id,
            status: 'ended',
            startedAt: extractStripeSubscriptionStartedAt(boundSub) ?? undefined,
            canceledAt: boundSub.canceled_at ? new Date(boundSub.canceled_at * 1000).toISOString() : undefined,
            accessExpiresAt: boundEndedAtIso,
            endedAt: boundEndedAtIso,
          });
        }

        let subscription: any = null;

        if (currentBoundSubId) {
          const otherActiveCandidates = eligibleSubs.filter(
            (s: any) => s.id !== currentBoundSubId && !s.cancel_at_period_end
          );

          const approvedReplacements: any[] = [];
          for (const candidate of otherActiveCandidates) {
            const canReplace = await this.canReplaceBoundSubscription({
              targetProfile: profile,
              currentBoundSubId,
              incomingSubId: candidate.id,
              isEligibleForPremium: true,
              isCanceledAtPeriodEnd: Boolean(candidate.cancel_at_period_end),
              incomingStartedAt: extractStripeSubscriptionStartedAt(candidate),
              isCheckoutCompletion: false,
              verifiedInStripe: true,
            });
            if (canReplace) {
              approvedReplacements.push(candidate);
            }
          }

          if (approvedReplacements.length === 1) {
            subscription = approvedReplacements[0];
          } else if (approvedReplacements.length > 1) {
            // Desambiguar apenas se exatamente uma candidata possuir evidência explícita de checkout/histórico
            const candidatesWithEvidence: any[] = [];
            for (const candidate of approvedReplacements) {
              const [{ data: checkoutEv }, { data: histEv }] = await Promise.all([
                supabaseAdmin
                  .from('stripe_events')
                  .select('id')
                  .eq('stripe_subscription_id', candidate.id)
                  .eq('stripe_event_type', 'checkout.session.completed')
                  .limit(1)
                  .maybeSingle(),
                supabaseAdmin
                  .from('stripe_subscription_history')
                  .select('stripe_subscription_id')
                  .eq('stripe_subscription_id', candidate.id)
                  .limit(1)
                  .maybeSingle(),
              ]);
              if (checkoutEv || histEv) {
                candidatesWithEvidence.push(candidate);
              }
            }
            if (candidatesWithEvidence.length === 1) {
              subscription = candidatesWithEvidence[0];
            } else {
              console.warn(
                `[StripeServerService-Sync] Múltiplas assinaturas ativas candidatas para o perfil ${userId}. Preservando vínculo atual ${currentBoundSubId} por segurança.`
              );
              return profile as Profile;
            }
          } else if (boundSub) {
            subscription = boundSub;
          } else {
            const isBoundSubTerminated = await this.hasSubscriptionTerminationEvidence(currentBoundSubId);
            if (!isBoundSubTerminated) {
              console.warn(
                `[StripeServerService-Sync] Assinatura vinculada ${currentBoundSubId} não localizada na listagem e sem evidência de encerramento. Preservando vínculo atual.`
              );
              return profile as Profile;
            }
            subscription = subscriptions.data[0];
          }
        } else {
          // Perfil atualmente sem stripe_subscription_id vinculado
          const { data: latestHistory } = await supabaseAdmin
            .from('stripe_subscription_history')
            .select('stripe_subscription_id, status, started_at, ended_at')
            .eq('user_id', userId)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const validEligibleSubs = eligibleSubs.filter((s: any) => {
            if (
              latestHistory?.stripe_subscription_id &&
              latestHistory.stripe_subscription_id !== s.id &&
              latestHistory.started_at
            ) {
              const candidateStart = extractStripeSubscriptionStartedAt(s);
              if (!candidateStart) return false;
              const candidateTime = new Date(candidateStart).getTime();
              const latestTime = new Date(latestHistory.started_at).getTime();
              if (Number.isNaN(candidateTime) || Number.isNaN(latestTime) || candidateTime <= latestTime) {
                return false;
              }
            }
            return true;
          });

          const nonCancelingEligible = validEligibleSubs.filter((s: any) => !s.cancel_at_period_end);
          const candidatePool = nonCancelingEligible.length > 0 ? nonCancelingEligible : validEligibleSubs;

          if (candidatePool.length === 1) {
            subscription = candidatePool[0];
          } else if (candidatePool.length > 1) {
            const candidatesWithEvidence: any[] = [];
            for (const candidate of candidatePool) {
              const [{ data: checkoutEv }, { data: histEv }] = await Promise.all([
                supabaseAdmin
                  .from('stripe_events')
                  .select('id')
                  .eq('stripe_subscription_id', candidate.id)
                  .eq('stripe_event_type', 'checkout.session.completed')
                  .limit(1)
                  .maybeSingle(),
                supabaseAdmin
                  .from('stripe_subscription_history')
                  .select('stripe_subscription_id')
                  .eq('stripe_subscription_id', candidate.id)
                  .limit(1)
                  .maybeSingle(),
              ]);
              if (checkoutEv || histEv) {
                candidatesWithEvidence.push(candidate);
              }
            }
            if (candidatesWithEvidence.length === 1) {
              subscription = candidatesWithEvidence[0];
            } else {
              console.warn(
                `[StripeServerService-Sync] Escolha ambígua entre múltiplas assinaturas ativas para o perfil ${userId}. Preservando estado atual sem conceder Premium.`
              );
              return profile as Profile;
            }
          } else {
            subscription = subscriptions.data[0];
          }
        }

        const isAlreadyTerminatedInDb = subscription?.id
          ? await this.hasSubscriptionTerminationEvidence(subscription.id)
          : false;
        const isEffectivelyCanceled =
          isAlreadyTerminatedInDb ||
          subscription.status === 'canceled' ||
          subscription.status === 'incomplete_expired' ||
          Boolean(subscription.ended_at);
        const currentPeriodEnd = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
        const isEligibleForPremium =
          (subscription.status === 'active' || subscription.status === 'trialing') &&
          !isEffectivelyCanceled;
        const endsAt = isEligibleForPremium && currentPeriodEnd
          ? new Date(currentPeriodEnd * 1000).toISOString()
          : null;

        const startedAt = extractStripeSubscriptionStartedAt(subscription);

        if (isEffectivelyCanceled && subscription?.id && subscription.id !== boundSub?.id) {
          const endedAtIso = subscription.ended_at
            ? new Date(subscription.ended_at * 1000).toISOString()
            : new Date().toISOString();
          await this.updateSubscriptionHistory({
            userId,
            stripeCustomerId,
            stripeSubscriptionId: subscription.id,
            status: 'ended',
            startedAt: startedAt ?? undefined,
            canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : undefined,
            accessExpiresAt: endedAtIso,
            endedAt: endedAtIso,
          });
        }

        if (!isEligibleForPremium && profile.stripe_subscription_id && profile.stripe_subscription_id !== subscription.id) {
          const isBoundSubTerminated = await this.hasSubscriptionTerminationEvidence(profile.stripe_subscription_id);
          if (!isBoundSubTerminated) {
            console.warn(
              `[StripeServerService-Sync] Ignorando sobrescrita por assinatura não elegível ${subscription.id} pois o perfil ${userId} está vinculado à assinatura ${profile.stripe_subscription_id}`
            );
            return profile as Profile;
          }
        }

        const status = isEffectivelyCanceled
          ? 'canceled'
          : (subscription.cancel_at_period_end
              ? 'canceled'
              : (isEligibleForPremium
                  ? 'active'
                  : (profile.subscription_status === 'trial' ? 'trial' : 'expired')));

        const updates: any = {
          subscription_status: status,
          subscription_ends_at: endsAt,
          stripe_subscription_id: isEffectivelyCanceled
            ? null
            : (isEligibleForPremium
                ? subscription.id
                : (profile.stripe_subscription_id === subscription.id ? subscription.id : null)),
          plan: isEligibleForPremium ? 'premium' : 'free',
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

        if (isEligibleForPremium && !subscription.cancel_at_period_end && accountStatus === 'pending_deletion') {
          console.log(`[StripeServerService-Sync] subscription reactivated for user ${userId}. Auto-cancelling account deletion.`);
          updates.account_status = 'active';
          updates.deletion_requested_at = null;
          updates.scheduled_deletion_at = null;
          autoCancelledDeletion = true;
        }

        console.log(`[StripeServerService] Atualizando dados locais de faturamento via sincronização:`, updates);
        const updatedRows = await this.updateProfileSubscription(userId, updates, {
          eventSubscriptionId: subscription.id,
          isEligibleForPremium,
          isCanceledAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          incomingStartedAt: startedAt,
          isCheckoutCompletion: false,
          verifiedInStripe: true,
        });

        const profileUpdateApplied = Array.isArray(updatedRows) && updatedRows.length > 0;
        const updatedProfile = profileUpdateApplied ? updatedRows[0] : profile;

        if (!profileUpdateApplied) {
          console.warn('[StripeServerService-Sync] Atualização de perfil bloqueada pelas regras de proteção da assinatura vinculada.');
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

        // HISTÓRICO: Sincronizar histórico local apenas para estados elegíveis ou encerramento terminal
        if (isEffectivelyCanceled) {
          const endedAtIso = subscription.ended_at
            ? new Date(subscription.ended_at * 1000).toISOString()
            : new Date().toISOString();
          await this.updateSubscriptionHistory({
            userId,
            stripeCustomerId,
            stripeSubscriptionId: subscription.id,
            status: 'ended',
            startedAt: startedAt ?? undefined,
            canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : undefined,
            accessExpiresAt: endedAtIso,
            endedAt: endedAtIso,
          });
        } else if (isEligibleForPremium && subscription.cancel_at_period_end) {
          await this.updateSubscriptionHistory({
            userId,
            stripeCustomerId,
            stripeSubscriptionId: subscription.id,
            status: 'canceling',
            startedAt: startedAt ?? undefined,
            canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : undefined,
            accessExpiresAt: endsAt ?? undefined,
            allowReactivationFromCanceling: false,
          });
        } else if (isEligibleForPremium) {
          await this.updateSubscriptionHistory({
            userId,
            stripeCustomerId,
            stripeSubscriptionId: subscription.id,
            status: 'active',
            startedAt: startedAt ?? undefined,
            accessExpiresAt: endsAt ?? undefined,
            allowReactivationFromCanceling: !subscription.cancel_at_period_end,
          });
        }

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
    allowReactivationFromCanceling?: boolean;
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
      allowReactivationFromCanceling = false,
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
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error('[StripeServerService] Error fetching existing subscription history:', fetchError.message);
      }

      if ((existingRecord?.status === 'ended' || Boolean(existingRecord?.ended_at)) && status !== 'ended') {
        console.warn(
          `[StripeServerService] Skipping history regression from ended to ${status} for subscription ${stripeSubscriptionId}`
        );
        return;
      }

      let effectiveStatus = status;
      if (existingRecord?.status === 'canceling' && status === 'active' && !allowReactivationFromCanceling) {
        console.warn(
          `[StripeServerService] Preserving canceling status in history for subscription ${stripeSubscriptionId} (blocked unconfirmed regression to active)`
        );
        effectiveStatus = 'canceling';
      }

      const dbUpdates: any = {
        user_id: userId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        status: effectiveStatus,
        updated_at: new Date().toISOString(),
      };

      // Controlar preenchimento condicional de datas
      if (effectiveStatus === 'active') {
        if (startedAt) {
          dbUpdates.started_at = startedAt;
        } else if (existingRecord?.started_at) {
          dbUpdates.started_at = existingRecord.started_at;
        } else {
          dbUpdates.started_at = new Date().toISOString();
        }
        // Se já existia valor de access_expires_at, mantém ou atualiza para manter consistência
        if (accessExpiresAt) {
          dbUpdates.access_expires_at = accessExpiresAt;
        } else if (existingRecord?.access_expires_at) {
          dbUpdates.access_expires_at = existingRecord.access_expires_at;
        }
        dbUpdates.canceled_at = null;
        dbUpdates.ended_at = null;
      }

      if (effectiveStatus === 'canceling') {
        dbUpdates.canceled_at = canceledAt || existingRecord?.canceled_at || new Date().toISOString();
        if (accessExpiresAt) {
          dbUpdates.access_expires_at = accessExpiresAt;
        } else if (existingRecord?.access_expires_at) {
          dbUpdates.access_expires_at = existingRecord.access_expires_at;
        }
        if (startedAt) {
          dbUpdates.started_at = startedAt;
        } else if (existingRecord?.started_at) {
          dbUpdates.started_at = existingRecord.started_at;
        }
      }

      if (effectiveStatus === 'ended') {
        if (endedAt) {
          dbUpdates.ended_at = endedAt;
        } else if (existingRecord?.ended_at) {
          dbUpdates.ended_at = existingRecord.ended_at;
        }
        if (accessExpiresAt) {
          dbUpdates.access_expires_at = accessExpiresAt;
        } else if (dbUpdates.ended_at) {
          dbUpdates.access_expires_at = dbUpdates.ended_at;
        } else if (existingRecord?.access_expires_at) {
          dbUpdates.access_expires_at = existingRecord.access_expires_at;
        }
        if (startedAt) {
          dbUpdates.started_at = startedAt;
        } else if (existingRecord?.started_at) {
          dbUpdates.started_at = existingRecord.started_at;
        }
        if (canceledAt) {
          dbUpdates.canceled_at = canceledAt;
        } else if (existingRecord?.canceled_at) {
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
   * Verifica se uma assinatura já possui evidência persistida de encerramento definitivo no banco.
   */
  async hasSubscriptionTerminationEvidence(stripeSubscriptionId: string): Promise<boolean> {
    if (!stripeSubscriptionId) return false;

    const [{ data: existingHistory }, { data: deletedEvent }] = await Promise.all([
      supabaseAdmin
        .from('stripe_subscription_history')
        .select('status, ended_at')
        .eq('stripe_subscription_id', stripeSubscriptionId)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('stripe_events')
        .select('id')
        .eq('stripe_subscription_id', stripeSubscriptionId)
        .eq('stripe_event_type', 'customer.subscription.deleted')
        .limit(1)
        .maybeSingle(),
    ]);

    return (
      existingHistory?.status === 'ended' ||
      Boolean(existingHistory?.ended_at) ||
      Boolean(deletedEvent)
    );
  },

  /**
   * Determina com segurança se um evento referente a `incomingSubId` pode substituir
   * a assinatura `currentBoundSubId` atualmente vinculada ao perfil.
   */
  async canReplaceBoundSubscription(params: {
    targetProfile: any;
    currentBoundSubId: string;
    incomingSubId: string;
    isEligibleForPremium: boolean;
    isCanceledAtPeriodEnd?: boolean;
    incomingStartedAt?: string | null;
    isCheckoutCompletion?: boolean;
    verifiedInStripe?: boolean;
  }): Promise<boolean> {
    const {
      targetProfile,
      currentBoundSubId,
      incomingSubId,
      isEligibleForPremium,
      isCanceledAtPeriodEnd = false,
      incomingStartedAt = null,
      isCheckoutCompletion = false,
      verifiedInStripe = false,
    } = params;

    if (!currentBoundSubId || currentBoundSubId === incomingSubId) {
      return true;
    }

    // 1. Eventos não elegíveis para Premium de outra assinatura nunca podem sobrescrever a assinatura vinculada
    if (!isEligibleForPremium) {
      return false;
    }

    // 2. Consultar evidências persistidas no banco para a assinatura vinculada e para a assinatura entrante
    const [
      { data: boundSubHistory },
      { data: boundSubDeletedEvent },
      { data: incomingHistory },
      { data: incomingDeletedEvent },
      { data: incomingCheckoutEvent },
    ] = await Promise.all([
      supabaseAdmin
        .from('stripe_subscription_history')
        .select('status, started_at, ended_at')
        .eq('stripe_subscription_id', currentBoundSubId)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('stripe_events')
        .select('id')
        .eq('stripe_subscription_id', currentBoundSubId)
        .eq('stripe_event_type', 'customer.subscription.deleted')
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('stripe_subscription_history')
        .select('status, started_at, ended_at')
        .eq('stripe_subscription_id', incomingSubId)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('stripe_events')
        .select('id')
        .eq('stripe_subscription_id', incomingSubId)
        .eq('stripe_event_type', 'customer.subscription.deleted')
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('stripe_events')
        .select('id')
        .eq('stripe_subscription_id', incomingSubId)
        .eq('stripe_event_type', 'checkout.session.completed')
        .limit(1)
        .maybeSingle(),
    ]);

    const isIncomingTerminated =
      incomingHistory?.status === 'ended' ||
      Boolean(incomingHistory?.ended_at) ||
      Boolean(incomingDeletedEvent);

    if (isIncomingTerminated) {
      return false;
    }

    let isBoundSubTerminated =
      boundSubHistory?.status === 'ended' ||
      Boolean(boundSubHistory?.ended_at) ||
      Boolean(boundSubDeletedEvent);

    let isBoundSubCancelingInStripe = false;
    let boundStripeStartedAt: string | null = null;

    if (!isBoundSubTerminated) {
      try {
        const stripe = getStripe();
        const liveBoundSub = await stripe.subscriptions.retrieve(currentBoundSubId) as any;
        boundStripeStartedAt = extractStripeSubscriptionStartedAt(liveBoundSub);
        const liveBoundTerminated =
          liveBoundSub.status === 'canceled' ||
          liveBoundSub.status === 'incomplete_expired' ||
          Boolean(liveBoundSub.ended_at);
        if (liveBoundTerminated) {
          isBoundSubTerminated = true;
        } else {
          isBoundSubCancelingInStripe = Boolean(liveBoundSub.cancel_at_period_end);
        }
      } catch (err: any) {
        if (err?.code === 'resource_missing' || err?.statusCode === 404 || err?.message?.includes('No such subscription')) {
          isBoundSubTerminated = true;
        } else {
          console.warn(
            `[StripeServerService] Could not confirm bound subscription ${currentBoundSubId} state in Stripe:`,
            err?.message || err
          );
        }
      }
    }

    // 3. Validar explicitamente os timestamps de início (started_at)
    const boundStartedAt = boundSubHistory?.started_at || boundStripeStartedAt || null;
    const resolvedIncomingStartedAt = incomingStartedAt || incomingHistory?.started_at || null;

    let hasValidTimestamps = false;
    let isIncomingStrictlyNewer = false;

    if (boundStartedAt && resolvedIncomingStartedAt) {
      const boundTime = new Date(boundStartedAt).getTime();
      const incomingTime = new Date(resolvedIncomingStartedAt).getTime();
      if (Number.isNaN(boundTime) || Number.isNaN(incomingTime)) {
        return false;
      }
      hasValidTimestamps = true;
      if (incomingTime <= boundTime) {
        // Assinatura mais antiga ou com mesmo started_at nunca substitui a assinatura vinculada
        return false;
      }
      isIncomingStrictlyNewer = true;
    }

    const hasExplicitCheckoutEvidence = Boolean(isCheckoutCompletion || incomingCheckoutEvent);

    // 4. Se a assinatura atualmente vinculada já está comprovadamente encerrada, permitir substituição
    // desde que a assinatura entrante seja mais recente (ou tenha evidência explícita quando a antiga não tinha started_at no banco)
    if (isBoundSubTerminated) {
      if (hasValidTimestamps) {
        return isIncomingStrictlyNewer;
      }
      return Boolean(hasExplicitCheckoutEvidence || verifiedInStripe);
    }

    // 5. Quando a assinatura vinculada NÃO está encerrada, uma assinatura entrante com cancelamento agendado não pode substituí-la
    if (isCanceledAtPeriodEnd || incomingHistory?.status === 'canceling') {
      return false;
    }

    // 6. Sem encerramento da assinatura vinculada, valores ausentes, iguais ou inconsistentes de started_at bloqueiam a troca
    if (!hasValidTimestamps || !isIncomingStrictlyNewer) {
      return false;
    }

    // 7. Além de started_at comprovadamente mais recente, exigir evidência confiável de nova contratação
    if (hasExplicitCheckoutEvidence) {
      return true;
    }

    const isBoundSubScheduledToCancel =
      targetProfile?.subscription_status === 'canceled' ||
      boundSubHistory?.status === 'canceling' ||
      isBoundSubCancelingInStripe;

    if (isBoundSubScheduledToCancel && verifiedInStripe) {
      return true;
    }

    return false;
  },

  /**
   * Utilitário para atualizar perfil no Supabase Admin com proteção da assinatura vinculada.
   */
  async updateProfileSubscription(
    userId: string,
    updates: any,
    options?: {
      eventSubscriptionId?: string | null;
      isEligibleForPremium?: boolean;
      isCanceledAtPeriodEnd?: boolean;
      incomingStartedAt?: string | null;
      isCheckoutCompletion?: boolean;
      verifiedInStripe?: boolean;
    }
  ) {
    console.log(`[StripeServerService] Starting Supabase update for userId: ${userId} with updates: ${JSON.stringify(updates)}`);

    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, plan, subscription_status, stripe_subscription_id, stripe_customer_id, subscription_ends_at')
      .eq('id', userId)
      .maybeSingle();

    const currentBoundSubId = currentProfile?.stripe_subscription_id || null;
    const incomingSubId = options?.eventSubscriptionId ?? updates?.stripe_subscription_id ?? null;
    const isEligibleForPremium =
      options?.isEligibleForPremium ??
      (updates?.plan === 'premium' || (updates?.plan === undefined && updates?.subscription_status === 'active'));

    if (isEligibleForPremium && incomingSubId) {
      const isIncomingTerminated = await this.hasSubscriptionTerminationEvidence(incomingSubId);
      if (isIncomingTerminated) {
        console.warn(
          `[StripeServerService] Blocking profile update in updateProfileSubscription for user ${userId}: subscription ${incomingSubId} already has termination evidence.`
        );
        return [];
      }
    }

    if (currentBoundSubId && (!incomingSubId || currentBoundSubId !== incomingSubId)) {
      if (!incomingSubId) {
        console.warn(
          `[StripeServerService] Blocking profile update in updateProfileSubscription for user ${userId}: missing incomingSubId while profile is bound to ${currentBoundSubId}.`
        );
        return [];
      }

      const canReplace = await this.canReplaceBoundSubscription({
        targetProfile: currentProfile,
        currentBoundSubId,
        incomingSubId,
        isEligibleForPremium,
        isCanceledAtPeriodEnd: options?.isCanceledAtPeriodEnd ?? (updates?.subscription_status === 'canceled' && isEligibleForPremium),
        incomingStartedAt: options?.incomingStartedAt ?? null,
        isCheckoutCompletion: options?.isCheckoutCompletion ?? false,
        verifiedInStripe: options?.verifiedInStripe ?? false,
      });

      if (!canReplace) {
        console.warn(
          `[StripeServerService] Blocking profile update in updateProfileSubscription for user ${userId}: incoming sub ${incomingSubId} cannot overwrite bound sub ${currentBoundSubId}.`
        );
        return [];
      }
    }

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
      console.warn(`[StripeServerService] SUPABASE UPDATE WARNING: No profile found to update with ID ${userId}. Attempting upsert for profile.`);
      const { data: upsertData, error: upsertError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: userId,
          ...updates,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select();

      if (upsertError) {
        console.error(`[StripeServerService] SUPABASE UPSERT FAIL for profile ${userId}: ${upsertError.message}`);
      } else {
        console.log(`[StripeServerService] SUPABASE UPSERT SUCCESS for profile ${userId}`);
      }
      return upsertData;
    } else {
      console.log(`[StripeServerService] SUPABASE UPDATE SUCCESS for profile ${userId}. Records updated: ${data.length}`);
    }

    return data;
  }
};
