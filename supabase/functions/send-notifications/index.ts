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
        await webpush.sendNotification(pushSubscription, JSON.stringify({
          title: 'Teste de Notificação 🚀',
          body: 'Seu sistema de notificações está funcionando corretamente!',
          url: '/dashboard'
        }))
      }

      return new Response(JSON.stringify({ success: true, message: 'Test notification sent' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
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
      if (notification.user_id && !enabledUserIds.has(notification.user_id)) {
        await supabase.from('notification_queue').update({ sent: true, sent_at: new Date().toISOString(), locked_until: null }).eq('id', notification.id)
        continue;
      }

      const userSubs = notification.user_id ? (allSubscriptions?.filter((s: any) => s.user_id === notification.user_id) || []) : []
      
      if (!notification.user_id || userSubs.length === 0) {
        await supabase.from('notification_queue').update({ sent: true, sent_at: new Date().toISOString(), locked_until: null }).eq('id', notification.id)
        processedCount++
        continue;
      }

      let sentAny = false

      for (const sub of userSubs) {
        const endpoint = sub.endpoint || (sub.subscription && sub.subscription.endpoint);
        if (!endpoint) continue;

        try {
          const pushSubscription = {
            endpoint: endpoint,
            keys: {
              p256dh: sub.p256dh || (sub.subscription && sub.subscription.keys && sub.subscription.keys.p256dh),
              auth: sub.auth || (sub.subscription && sub.subscription.keys && sub.subscription.keys.auth)
            }
          };

          if (!pushSubscription.keys.p256dh || !pushSubscription.keys.auth) continue;

          console.log(`[Push 4B] Sending to user ${notification.user_id} (sub: ${endpoint.substring(0, 30)}...)`);
          await webpush.sendNotification(pushSubscription, JSON.stringify({
            title: notification.title,
            body: notification.body,
            url: notification.metadata?.url || '/dashboard'
          }))
          sentAny = true
        } catch (err: any) {
          console.error(`Error sending queued push:`, err)
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
          }
        }
      }

      if (sentAny || userSubs.length === 0) {
        await supabase.from('notification_queue').update({
          sent: true,
          sent_at: new Date().toISOString(),
          locked_until: null
        }).eq('id', notification.id)
        processedCount++
      } else {
        const newRetryCount = (notification.retry_count || 0) + 1
        const MAX_RETRIES = 5

        if (newRetryCount >= MAX_RETRIES) {
          console.warn(`[Push 4B.1] Notification ${notification.id} reached max retries (${newRetryCount}). Marking sent=true with failure metadata.`);
          await supabase.from('notification_queue').update({
            sent: true,
            retry_count: newRetryCount,
            locked_until: null,
            metadata: {
              ...(notification.metadata || {}),
              failed_reason: 'MAX_RETRIES_EXCEEDED',
              max_retries_exceeded: true,
              failed_at: new Date().toISOString()
            }
          }).eq('id', notification.id)
        } else {
          const retryAtDate = new Date(Date.now() + 10 * 60 * 1000).toISOString()
          await supabase.from('notification_queue').update({
            retry_count: newRetryCount,
            retry_at: retryAtDate,
            locked_until: null
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
