import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const now = new Date()
    const oneMinuteAgo = new Date(now.getTime() - 60000)

    // 1. Buscar notificações agendadas (one-off) na fila
    // Seguindo a lógica solicitada: scheduled_at entre um minuto atrás e agora
    const { data: queuedNotifications, error: queueError } = await supabase
      .from('notification_queue')
      .select('*')
      .eq('sent', false)
      .gte('scheduled_at', oneMinuteAgo.toISOString())
      .lte('scheduled_at', now.toISOString())

    if (queueError) throw queueError

    // 2. Buscar lembretes de medicação recorrentes (para manter a funcionalidade atual)
    const { data: reminders, error: remindersError } = await supabase
      .from('medication_reminders')
      .select(`
        *,
        medications!inner(usage_category)
      `)
      .eq('active', true)
      .neq('medications.usage_category', 'prn')

    if (remindersError) throw remindersError

    const userIds = [
      ...(reminders?.map(r => r.user_id) || []),
      ...(queuedNotifications?.map(n => n.user_id) || [])
    ]
    
    const uniqueUserIds = [...new Set(userIds)]
    if (uniqueUserIds.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 3. Buscar usuários habilitados e suas assinaturas
    const { data: enabledPrefs } = await supabase
      .from('user_preferences')
      .select('user_id')
      .eq('push_notifications_enabled', true)
      .in('user_id', uniqueUserIds)

    const enabledUserIds = new Set(enabledPrefs?.map(p => p.user_id) || [])

    const { data: allSubscriptions } = await supabase
      .from('push_subscriptions')
      .select('user_id, subscription, timezone, endpoint, p256dh, auth')
      .in('user_id', Array.from(enabledUserIds))

    const results = []

    // Processar notificações da fila (one-off) - PRIORIDADE
    if (queuedNotifications && queuedNotifications.length > 0) {
      for (const notification of queuedNotifications) {
        if (!enabledUserIds.has(notification.user_id)) continue;

        const userSubs = allSubscriptions?.filter(s => s.user_id === notification.user_id) || []
        for (const sub of userSubs) {
          try {
            const pushSubscription = {
              endpoint: sub.endpoint || (sub.subscription && sub.subscription.endpoint),
              keys: {
                p256dh: sub.p256dh || (sub.subscription && sub.subscription.keys && sub.subscription.keys.p256dh),
                auth: sub.auth || (sub.subscription && sub.subscription.keys && sub.subscription.keys.auth)
              }
            };

            if (!pushSubscription.endpoint || !pushSubscription.keys.p256dh || !pushSubscription.keys.auth) continue;

            await webpush.sendNotification(pushSubscription, JSON.stringify({
              title: notification.title,
              body: notification.body,
              url: '/dashboard'
            }))
            results.push({ type: 'queue', id: notification.id })
          } catch (err) {
            console.error(`Error sending queued push:`, err)
            if (err.statusCode === 410 || err.statusCode === 404) {
              await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint || (sub.subscription && sub.subscription.endpoint))
            }
          }
        }
        // Marcar como enviada IMEDIATAMENTE após o loop de assinaturas
        await supabase.from('notification_queue').update({ 
          sent: true,
          sent_at: new Date().toISOString()
        }).eq('id', notification.id)
      }
    }

    // Processar lembretes recorrentes
    if (reminders && reminders.length > 0) {
      for (const reminder of reminders) {
        if (!enabledUserIds.has(reminder.user_id)) continue;

        const userSubs = allSubscriptions?.filter(s => s.user_id === reminder.user_id) || []
        for (const sub of userSubs) {
          const userTime = now.toLocaleTimeString('pt-BR', {
            timeZone: sub.timezone || 'UTC',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          })
          const reminderTimeShort = reminder.reminder_time.substring(0, 5)

          if (userTime === reminderTimeShort) {
            try {
              const pushSubscription = {
                endpoint: sub.endpoint || (sub.subscription && sub.subscription.endpoint),
                keys: {
                  p256dh: sub.p256dh || (sub.subscription && sub.subscription.keys && sub.subscription.keys.p256dh),
                  auth: sub.auth || (sub.subscription && sub.subscription.keys && sub.subscription.keys.auth)
                }
              };

              if (!pushSubscription.endpoint || !pushSubscription.keys.p256dh || !pushSubscription.keys.auth) continue;

              await webpush.sendNotification(pushSubscription, JSON.stringify({
                title: 'Hora do Medicamento 💊',
                body: reminder.message_template || `Lembrete: Tomar ${reminder.medication_name}`,
                url: '/dashboard'
              }))
              results.push({ type: 'medication', id: reminder.id })
            } catch (err) {
              console.error(`Error sending push:`, err)
              if (err.statusCode === 410 || err.statusCode === 404) {
                await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint || (sub.subscription && sub.subscription.endpoint))
              }
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
