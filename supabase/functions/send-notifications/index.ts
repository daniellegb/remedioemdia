import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"
import { generateDailySummary, SummaryCycle, SummaryGeneratorInput } from "../_shared/domain/summaryGenerator.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Mapper para converter registro SQL de medicamentos para o formato camelCase do domínio
 */
function mapMedToCamelCase(med: any) {
  return {
    id: med.id,
    name: med.name,
    dosage: med.dosage,
    unit: med.unit,
    usageCategory: med.usage_category,
    dosesPerDay: med.doses_per_day ? (typeof med.doses_per_day === 'number' ? `${med.doses_per_day}x` : med.doses_per_day) : '1x',
    intervalDays: med.interval_days,
    times: med.times,
    intervalType: med.interval_type,
    contraceptiveType: med.contraceptive_type,
    startDate: med.start_date,
    endDate: med.end_date,
    durationDays: med.duration_days,
    maxDosesPerDay: med.max_doses_per_day,
    totalStock: Number(med.total_stock) || 0,
    currentStock: Number(med.current_stock) || 0,
    expiryDate: med.expiry_date,
    notes: med.notes,
    color: med.color,
    frequency: med.frequency || 1,
    next_dose_at: med.next_dose_at,
    active: med.active !== false && med.active !== 'false' && med.active !== 0,
    deleted: med.deleted === true,
    keep_history: med.keep_history !== false,
    deleted_at: med.deleted_at
  };
}

/**
 * Mapper para converter registro SQL de consultas/exames para o formato camelCase do domínio
 */
function mapAppToCamelCase(app: any) {
  return {
    id: app.id,
    type: app.type,
    doctor: app.doctor,
    specialty: app.specialty,
    date: app.date,
    time: app.time,
    location: app.location,
    notes: app.notes,
    active: app.active !== false && app.active !== 'false' && app.active !== 0,
    deleted: app.deleted === true,
    keep_history: app.keep_history !== false,
    deleted_at: app.deleted_at
  };
}

/**
 * Formatação do payload de Web Push
 * Para novos resumos consolidados ('daily_summary'), utiliza diretamente o título e texto estruturados gerados.
 */
function formatPushPayload(notification: any, _sub?: any) {
  if (notification.metadata?.type === 'daily_summary' || notification.body) {
    return {
      title: notification.title || 'Remédio em Dia',
      body: notification.body
    };
  }

  return {
    title: 'Remédio em Dia',
    body: 'Confira seus lembretes no Painel Hoje.'
  };
}

/**
 * A) GERAÇÃO DE RESUMOS
 * 
 * Avalia os usuários com push ativo, identifica se a hora local atual corresponde
 * a um dos 3 ciclos canônicos (08:00 -> morning, 13:00 -> afternoon, 19:00 -> night),
 * executa o summaryGenerator e insere o resumo na notification_queue de forma idempotente.
 */
async function generateDueSummaries(supabase: any) {
  try {
    // 1. Carregar preferências de usuários com notificações push habilitadas
    const { data: activePrefs, error: prefsError } = await supabase
      .from('user_preferences')
      .select('user_id, timezone, threshold_running_out, threshold_expiring, push_notifications_enabled')
      .eq('push_notifications_enabled', true)

    if (prefsError) {
      console.error('[Summary Generator] Error fetching user_preferences:', prefsError)
      return { generated: 0 }
    }

    if (!activePrefs || activePrefs.length === 0) {
      return { generated: 0 }
    }

    const targetUserIds = activePrefs.map((p: any) => p.user_id)

    // 2. Carregar push_subscriptions para fallback de timezone
    const { data: userSubs } = await supabase
      .from('push_subscriptions')
      .select('user_id, timezone')
      .in('user_id', targetUserIds)

    const subTimezoneMap = new Map<string, string>()
    if (userSubs) {
      for (const sub of userSubs) {
        if (sub.user_id && sub.timezone && !subTimezoneMap.has(sub.user_id)) {
          subTimezoneMap.set(sub.user_id, sub.timezone)
        }
      }
    }

    // 3. Determinar quais usuários estão em horário de ciclo
    const now = new Date()
    interface UserCycleCandidate {
      userId: string;
      pref: any;
      timezone: string;
      localDate: string;
      cycle: SummaryCycle;
    }

    const usersInCycle: UserCycleCandidate[] = []

    for (const pref of activePrefs) {
      const userTz = pref.timezone || subTimezoneMap.get(pref.user_id) || 'America/Sao_Paulo'
      let localDate: string
      let localHour: number

      try {
        localDate = new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(now) // YYYY-MM-DD
        const hourStr = new Intl.DateTimeFormat('pt-BR', { timeZone: userTz, hour: '2-digit', hourCycle: 'h23' }).format(now)
        localHour = parseInt(hourStr, 10)
      } catch (_err) {
        // Fallback seguro de timezone em caso de formato inválido
        localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now)
        const hourStr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(now)
        localHour = parseInt(hourStr, 10)
      }

      let cycle: SummaryCycle | null = null
      if (localHour === 8) {
        cycle = 'morning'
      } else if (localHour === 13) {
        cycle = 'afternoon'
      } else if (localHour === 19) {
        cycle = 'night'
      }

      if (cycle) {
        usersInCycle.push({
          userId: pref.user_id,
          pref,
          timezone: userTz,
          localDate,
          cycle
        })
      }
    }

    // Se nenhum usuário estiver em horário de ciclo, encerra sem realizar consultas adicionais
    if (usersInCycle.length === 0) {
      return { generated: 0 }
    }

    const cycleUserIds = usersInCycle.map(u => u.userId)

    // 4. Carregar em lote medicamentos e consultas dos usuários em ciclo (evita N+1 queries)
    const [{ data: allMeds, error: medsError }, { data: allApps, error: appsError }] = await Promise.all([
      supabase
        .from('medications')
        .select('*')
        .in('user_id', cycleUserIds)
        .or('deleted.is.null,deleted.eq.false')
        .or('active.is.null,active.eq.true'),
      supabase
        .from('appointments')
        .select('*')
        .in('user_id', cycleUserIds)
        .or('deleted.is.null,deleted.eq.false')
        .or('active.is.null,active.eq.true')
    ])

    if (medsError) console.error('[Summary Generator] Error fetching medications in batch:', medsError)
    if (appsError) console.error('[Summary Generator] Error fetching appointments in batch:', appsError)

    // Agrupar em memória por user_id
    const medsByUser = new Map<string, any[]>()
    if (allMeds) {
      for (const med of allMeds) {
        if (!med.user_id) continue
        const list = medsByUser.get(med.user_id) || []
        list.push(mapMedToCamelCase(med))
        medsByUser.set(med.user_id, list)
      }
    }

    const appsByUser = new Map<string, any[]>()
    if (allApps) {
      for (const app of allApps) {
        if (!app.user_id) continue
        const list = appsByUser.get(app.user_id) || []
        list.push(mapAppToCamelCase(app))
        appsByUser.set(app.user_id, list)
      }
    }

    let generatedCount = 0

    // 5. Executar o gerador de resumos para cada usuário em ciclo
    for (const candidate of usersInCycle) {
      const userMeds = medsByUser.get(candidate.userId) || []
      const userApps = appsByUser.get(candidate.userId) || []

      const input: SummaryGeneratorInput = {
        userId: candidate.userId,
        userTimezone: candidate.timezone,
        cycle: candidate.cycle,
        localDate: candidate.localDate,
        medications: userMeds,
        appointments: userApps,
        preferences: candidate.pref
      }

      const summary = generateDailySummary(input)

      // Regra de Silêncio: se não houver conteúdo relevante, não insere absolutamente nada na fila
      if (!summary.shouldNotify) {
        continue
      }

      // Inserção idempotente na notification_queue utilizando a constraint UNIQUE (occurrence_key)
      const { error: insertError } = await supabase
        .from('notification_queue')
        .upsert({
          user_id: candidate.userId,
          title: summary.title,
          body: summary.body,
          trigger_at: new Date().toISOString(),
          scheduled_at: new Date().toISOString(),
          sent: false,
          occurrence_key: summary.occurrenceKey,
          retry_count: 0,
          metadata: summary.metadata
        }, {
          onConflict: 'occurrence_key',
          ignoreDuplicates: true
        })

      if (insertError) {
        console.error(`[Summary Generator] Error inserting summary for user ${candidate.userId}:`, insertError)
      } else {
        generatedCount++
      }
    }

    return { generated: generatedCount }
  } catch (err: any) {
    console.error('[Summary Generator] Unexpected error during summary generation:', err?.message || err)
    return { generated: 0, error: err?.message || String(err) }
  }
}

/**
 * B) DISPATCHER DA FILA
 * 
 * Reivindica mensagens pendentes da notification_queue via claim_due_notification_queue,
 * valida preferências e subscriptions ativas, e despacha via Web Push.
 */
async function dispatchNotificationQueue(supabase: any) {
  // 1. Processar notificações da notification_queue usando a RPC transacional claim_due_notification_queue
  const { data: queuedNotifications, error: rpcError } = await supabase.rpc('claim_due_notification_queue', {
    p_batch_size: 50,
    p_lock_minutes: 5
  })

  if (rpcError) throw rpcError
  console.log(`[Queue Dispatcher] Claimed ${queuedNotifications?.length || 0} queued notifications.`);

  if (!queuedNotifications || queuedNotifications.length === 0) {
    return { processed: 0 }
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
            tag: notification.occurrence_key || notification.id || `summary-${Date.now()}`,
            requireInteraction: true,
            url: notification.metadata?.url || '/dashboard'
          }),
          {
            TTL: 86400,
            urgency: 'high',
            topic: notification.metadata?.cycle ? `summary-${notification.metadata.cycle}` : undefined
          }
        )

        sentAny = true
      } catch (err: any) {
        console.error(`[Push Dispatcher] Error sending push:`, err)
        lastError = err.message || String(err)

        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log(`[Push Dispatcher] Subscription expired or missing (HTTP ${err.statusCode}). Deleting subscription endpoint: ${endpoint.substring(0, 30)}...`);
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
        console.warn(`[Push Dispatcher] Notification ${notification.id} reached max retries (${newRetryCount}). Marking status='failed'.`);
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

  return { processed: processedCount }
}

/**
 * Servidor HTTP da Edge Function send-notifications
 */
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
    
    // 1. Lógica de Teste e Debug (mantida para compatibilidade do botão de teste de notificações)
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

    // 2. Geração dos Resumos Diários de Notificação (Novo Gerador)
    const genResult = await generateDueSummaries(supabase)

    // 3. Processamento e Despacho da Fila via Web Push
    const dispatchResult = await dispatchNotificationQueue(supabase)

    return new Response(JSON.stringify({ 
      success: true, 
      generated: genResult.generated,
      processed: dispatchResult.processed 
    }), {
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
