import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function formatPushPayload(notification: any, _sub?: any) {
  const pushTitle = 'Remédio em Dia';
  const metaType = notification.metadata?.type || '';
  const bodyText = notification.body || '';

  // 1. Notificação de Medicamento Vencido
  if (metaType === 'medication_expired' || bodyText.includes('Remédio vencido') || bodyText.toLowerCase().includes('vencido')) {
    return {
      title: pushTitle,
      body: 'Remédio vencido. Verifique no Painel Hoje.'
    };
  }

  // 2. Notificação de Medicamento Próximo da Validade
  if (metaType === 'medication_expiring_soon' || bodyText.includes('próximo da data de validade') || bodyText.toLowerCase().includes('validade')) {
    return {
      title: pushTitle,
      body: 'Remédio próximo da data de validade. Verifique no Painel Hoje.'
    };
  }

  // 3. Notificação de Medicamento Sem Estoque
  if (metaType === 'medication_out_of_stock' || bodyText.includes('sem estoque') || bodyText.toLowerCase().includes('sem estoque')) {
    return {
      title: pushTitle,
      body: 'Remédio sem estoque. Verifique no Painel Hoje.'
    };
  }

  // 4. Notificação de Medicamento Próximo de Acabar
  if (metaType === 'medication_stock_running_out' || bodyText.includes('próximo de acabar') || bodyText.toLowerCase().includes('acabar')) {
    return {
      title: pushTitle,
      body: 'Remédio próximo de acabar. Verifique no Painel Hoje.'
    };
  }

  // 5. Notificação de Consulta Médica ou Exame (se aplicável)
  if (notification.appointment_id || notification.metadata?.appointment_id) {
    const rawType = String(notification.metadata?.type || notification.body || '').toLowerCase();
    const isExam = rawType.includes('exame');
    return {
      title: pushTitle,
      body: isExam
        ? 'Você tem um exame agendado. Confira os detalhes no Painel Hoje.'
        : 'Você tem uma consulta agendada. Confira os detalhes no Painel Hoje.'
    };
  }

  // 6. Política Padrão / Notificação de Administração (Horário de dose)
  return {
    title: pushTitle,
    body: 'Passamos por um horário de administração. Confira seus remédios no Painel Hoje.'
  };
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

        const testId = `test-${Date.now()}`;
        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify({
            id: testId,
            notification_id: testId,
            scheduled_at: now.toISOString(),
            title: 'Remédio em Dia',
            body: `Notificação de teste — agendada para ${dateStr} às ${timeStr}.`,
            icon: '/remedio-em-dia-icone-small.png',
            badge: '/remedio-em-dia-icone-small.png',
            tag: 'test-notification',
            requireInteraction: true,
            url: '/dashboard'
          }),
          {
            TTL: 86400,
            urgency: 'high'
          }
        )
      }

      return new Response(JSON.stringify({ success: true, message: 'Test notification sent' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 1.5 Gerar ocorrências devidas de medicação, estoque e validade para a notification_queue (Etapa 4B.1)
    try {
      await supabase.rpc('claim_due_medication_occurrences', { p_batch_size: 100 })
    } catch (err: any) {
      console.warn('[Queue Dispatcher 4B.1] Error claiming medication occurrences:', err?.message || err)
    }

    try {
      await supabase.rpc('claim_due_stock_and_expiry_occurrences', { p_batch_size: 100 })
    } catch (err: any) {
      console.warn('[Queue Dispatcher 4B.1] Error claiming stock/expiry occurrences:', err?.message || err)
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
            discarded_at: nowIso
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
            discarded_at: nowIso
          }
        }).eq('id', notification.id)
        processedCount++
        continue;
      }

      let sentAny = false
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
          continue;
        }

        try {
          const payload = formatPushPayload(notification, sub);
          await webpush.sendNotification(
            pushSubscription,
            JSON.stringify({
              id: notification.id,
              notification_id: notification.id,
              scheduled_at: notification.scheduled_at || notification.trigger_at,
              title: payload.title,
              body: payload.body,
              icon: '/remedio-em-dia-icone-small.png',
              badge: '/remedio-em-dia-icone-small.png',
              tag: notification.id || `medication-${notification.medication_id || Date.now()}`,
              requireInteraction: true,
              url: notification.metadata?.url || '/historico'
            }),
            {
              TTL: 86400,
              urgency: 'high',
              topic: notification.metadata?.topic || undefined
            }
          )

          sentAny = true
        } catch (err: any) {
          console.error(`[Push 4B] Error sending push:`, err)
          lastError = err.message || String(err)

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
            status: 'sent'
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
              last_error: lastError,
              failed_at: new Date().toISOString()
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
              last_error: lastError,
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
