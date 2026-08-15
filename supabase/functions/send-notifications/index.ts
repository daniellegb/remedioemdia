import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function formatPushPayload(notification: any, sub?: any) {
  const pushTitle = 'Remédio em Dia';
  let pushBody = notification.body || '';

  const formatDateTime = (dateVal: string | Date, timeVal?: string, tz: string = 'America/Sao_Paulo') => {
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal.trim())) {
      const [, m, d] = dateVal.trim().split('-');
      const dateStr = `${d}/${m}`;
      const timeStr = timeVal ? timeVal.substring(0, 5) : '00:00';
      return { dateStr, timeStr };
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return { dateStr: '01/01', timeStr: '00:00' };
    const dateStr = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(d);
    const timeStr = timeVal ? timeVal.substring(0, 5) : new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    return { dateStr, timeStr };
  };

  if (!pushBody || !pushBody.includes(' — agendada para ')) {
    const userTz = notification.metadata?.timezone || sub?.timezone || 'America/Sao_Paulo';

    if (notification.appointment_id || notification.metadata?.appointment_id || notification.metadata?.type) {
      const type = notification.metadata?.type || 'Consulta';
      const detail = notification.metadata?.doctor_or_specialty || notification.metadata?.specialty || notification.metadata?.doctor || 'Geral';
      const eventDate = notification.metadata?.event_date;
      const eventTime = notification.metadata?.event_time;

      const { dateStr, timeStr } = formatDateTime(
        eventDate || notification.scheduled_at || notification.trigger_at,
        eventTime,
        userTz
      );

      pushBody = `${type}: ${detail} — agendada para ${dateStr} às ${timeStr}.`;
    } else {
      let medName = notification.metadata?.medication_name;
      if (!medName) {
        medName = (notification.body || '')
          .replace(/^Lembrete:\s*/i, '')
          .replace(/^Hora do Medicamento:?\s*/i, '')
          .replace(/^Tomar\s+/i, '')
          .replace(/\s*\([^)]*\)/g, '')
          .trim() || 'Medicamento';
      }
      const { dateStr, timeStr } = formatDateTime(
        notification.scheduled_at || notification.trigger_at,
        undefined,
        userTz
      );

      pushBody = `${medName} — agendada para ${dateStr} às ${timeStr}.`;
    }
  }

  return { title: pushTitle, body: pushBody };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:example@yourdomain.com'

    if (!vapidPublicKey || !vapidPrivateKey) {
      throw new Error('VAPID keys are missing in environment variables')
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // 1. Lógica de Teste e Debug (mantida para compatibilidade do botão de teste)
    const body = await req.json().catch(() => ({}))
    
    if (body.debug) {
      return new Response(JSON.stringify({
        success: true,
        vapidPublicKey: vapidPublicKey.substring(0, 10) + '...',
        envMatch: body.clientEnv?.VAPID_PUBLIC_KEY === vapidPublicKey,
        serverTime: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (body.test && body.userId) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', body.userId)
      
      if (!subs || subs.length === 0) {
        return new Response(JSON.stringify({ error: 'No subscriptions found for user' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        })
      }

      for (const sub of subs) {
        const pushSubscription = {
          endpoint: sub.endpoint || (sub.subscription && sub.subscription.endpoint),
          keys: {
            p256dh: sub.p256dh || (sub.subscription && sub.subscription.keys && sub.subscription.keys.p256dh),
            auth: sub.auth || (sub.subscription && sub.subscription.keys && sub.subscription.keys.auth)
          }
        };
        const now = new Date();
        const dateStr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(now);
        const timeStr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);

        await webpush.sendNotification(pushSubscription, JSON.stringify({
          title: 'Remédio em Dia',
          body: `Notificação de teste — agendada para ${dateStr} às ${timeStr}.`,
          icon: '/remedio-em-dia-icone-small.png',
          url: '/dashboard'
        }))
      }

      return new Response(JSON.stringify({ success: true, message: 'Test notification sent' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 1.5 Gerar ocorrências devidas de medication_reminders para a notification_queue (Etapa 4B.1)
    try {
      await supabase.rpc('claim_due_medication_occurrences', { p_batch_size: 100 })
    } catch (err: any) {
      console.warn('[Queue Dispatcher 4B.1] Error claiming medication occurrences:', err?.message || err)
    }

    // 2. Processar notificações da notification_queue usando a RPC transacional claim_due_notification_queue (Etapa 4B)
    const { data: queuedNotifications, error: rpcError } = await supabase.rpc('claim_due_notification_queue', {
      p_batch_size: 50,
      p_lock_minutes: 5
    })

    if (rpcError) throw rpcError
    console.log(`[Queue Dispatcher 4B] Claimed ${queuedNotifications?.length || 0} queued notifications.`);

    if (!queuedNotifications || queuedNotifications.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const userIds = [...new Set(queuedNotifications.map((n: any) => n.user_id).filter(Boolean))]

    // Buscar usuários habilitados e suas assinaturas
    const { data: enabledPrefs } = userIds.length > 0 ? await supabase
      .from('user_preferences')
      .select('user_id')
      .eq('push_notifications_enabled', true)
      .in('user_id', userIds) : { data: [] }

    const enabledUserIds = new Set(enabledPrefs?.map((p: any) => p.user_id) || [])

    const { data: allSubscriptions } = userIds.length > 0 ? await supabase
      .from('push_subscriptions')
      .select('user_id, subscription, timezone, endpoint, p256dh, auth')
      .in('user_id', Array.from(enabledUserIds)) : { data: [] }

    let processedCount = 0

    for (const notification of queuedNotifications) {
      const nowIso = new Date().toISOString()

      // Caso 1: Usuário desabilitou notificações push nas preferências
      if (notification.user_id && !enabledUserIds.has(notification.user_id)) {
        await supabase.from('notification_queue').update({
          sent: false,
          locked_until: null,
          metadata: {
            ...(notification.metadata || {}),
            status: 'discarded',
            discarded_reason: 'PUSH_NOTIFICATIONS_DISABLED',
            discarded_at: nowIso,
            web_push_attempted: false,
            os_delivery_guarantee: 'none_not_attempted'
          }
        }).eq('id', notification.id)
        processedCount++
        continue;
      }

      const userSubs = notification.user_id ? (allSubscriptions?.filter((s: any) => s.user_id === notification.user_id) || []) : []

      // Caso 2: Não há usuário ou não existe subscription ativa para o usuário
      if (!notification.user_id || userSubs.length === 0) {
        await supabase.from('notification_queue').update({
          sent: false,
          locked_until: null,
          metadata: {
            ...(notification.metadata || {}),
            status: 'discarded',
            discarded_reason: 'NO_ACTIVE_SUBSCRIPTION',
            discarded_at: nowIso,
            web_push_attempted: false,
            os_delivery_guarantee: 'none_not_attempted'
          }
        }).eq('id', notification.id)
        processedCount++
        continue;
      }

      let sentAny = false
      const deliveryAttempts: any[] = []
      let lastError: string | null = null

      for (const sub of userSubs) {
        const endpoint = sub.endpoint || (sub.subscription && sub.subscription.endpoint);
        if (!endpoint) continue;

        const pushSubscription = {
          endpoint: endpoint,
          keys: {
            p256dh: sub.p256dh || (sub.subscription && sub.subscription.keys && sub.subscription.keys.p256dh),
            auth: sub.auth || (sub.subscription && sub.subscription.keys && sub.subscription.keys.auth)
          }
        };

        if (!pushSubscription.keys.p256dh || !pushSubscription.keys.auth) {
          deliveryAttempts.push({
            endpoint: endpoint.substring(0, 40) + '...',
            success: false,
            error: 'MISSING_P256DH_OR_AUTH_KEYS',
            attempted_at: new Date().toISOString()
          })
          continue;
        }

        try {
          const payload = formatPushPayload(notification, sub);
          console.log(`[Push 4B] Sending Web Push to user ${notification.user_id} (title: "${payload.title}", body: "${payload.body}")`);
          const pushResult = await webpush.sendNotification(pushSubscription, JSON.stringify({
            title: payload.title,
            body: payload.body,
            icon: '/remedio-em-dia-icone-small.png',
            url: notification.metadata?.url || '/dashboard'
          }))

          sentAny = true
          deliveryAttempts.push({
            endpoint: endpoint.substring(0, 40) + '...',
            success: true,
            statusCode: pushResult.statusCode || 201,
            attempted_at: new Date().toISOString()
          })
        } catch (err: any) {
          console.error(`[Push 4B] Error sending push:`, err)
          lastError = err.message || String(err)
          deliveryAttempts.push({
            endpoint: endpoint.substring(0, 40) + '...',
            success: false,
            statusCode: err.statusCode,
            error: lastError,
            attempted_at: new Date().toISOString()
          })

          if (err.statusCode === 410 || err.statusCode === 404) {
            console.log(`[Push 4B] Subscription expired or missing (HTTP ${err.statusCode}). Deleting subscription endpoint: ${endpoint.substring(0, 30)}...`);
            await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
          }
        }
      }

      if (sentAny) {
        await supabase.from('notification_queue').update({
          sent: true,
          sent_at: new Date().toISOString(),
          locked_until: null,
          metadata: {
            ...(notification.metadata || {}),
            status: 'accepted_by_push_service',
            web_push_attempted: true,
            delivery_attempts: deliveryAttempts,
            os_delivery_guarantee: 'asynchronous_device_delivery_not_guaranteed_by_os'
          }
        }).eq('id', notification.id)
        processedCount++
      } else {
        const newRetryCount = (notification.retry_count || 0) + 1
        const MAX_RETRIES = 5

        if (newRetryCount >= MAX_RETRIES) {
          console.warn(`[Push 4B.1] Notification ${notification.id} reached max retries (${newRetryCount}). Marking status='failed'.`);
          await supabase.from('notification_queue').update({
            sent: false,
            retry_count: newRetryCount,
            locked_until: null,
            metadata: {
              ...(notification.metadata || {}),
              status: 'failed',
              failed_reason: 'PUSH_SERVICE_ERROR_MAX_RETRIES',
              web_push_attempted: true,
              last_error: lastError,
              delivery_attempts: deliveryAttempts,
              failed_at: new Date().toISOString(),
              os_delivery_guarantee: 'failed_push_service_error'
            }
          }).eq('id', notification.id)
          processedCount++
        } else {
          const retryAtDate = new Date(Date.now() + 10 * 60 * 1000).toISOString()
          await supabase.from('notification_queue').update({
            sent: false,
            retry_count: newRetryCount,
            retry_at: retryAtDate,
            locked_until: null,
            metadata: {
              ...(notification.metadata || {}),
              status: 'retrying',
              web_push_attempted: true,
              last_error: lastError,
              delivery_attempts: deliveryAttempts,
              last_attempt_at: new Date().toISOString()
            }
          }).eq('id', notification.id)
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed: processedCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
