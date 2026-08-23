
import { supabase } from '../lib/supabase';

export const pushService = {
  async saveSubscription(userId: string, subscription: PushSubscription) {
    const rawSubData = subscription.toJSON();
    const endpoint = rawSubData.endpoint;
    const p256dh = rawSubData.keys?.p256dh;
    const auth = rawSubData.keys?.auth;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    const isAndroid = userAgent.includes('Android');
    const isIOS = userAgent.includes('iPhone') || userAgent.includes('iPad');
    const deviceType = isAndroid ? 'android' : (isIOS ? 'ios' : 'desktop');

    const subData = {
      ...rawSubData,
      device_type: deviceType,
      user_agent: userAgent
    };
    
    // Garantir que o endpoint seja a única restrição de conflito para suportar múltiplos dispositivos
    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        endpoint: endpoint,
        p256dh: p256dh,
        auth: auth,
        subscription: subData, // mantemos o JSON completo com device_type e user_agent
        timezone: timezone
      }, { 
        onConflict: 'endpoint' // Requisito Obrigatório: Unicidade por endpoint
      });

    if (error) {
      console.error("Erro ao salvar assinatura push:", error);
      throw error;
    }
    return data;
  },

  async deleteSubscription(endpoint: string) {
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint);

    if (error) throw error;
  },

  async checkVapidMatch() {
    try {
      const isVite = typeof import.meta !== 'undefined' && import.meta.env;
      // Tentar ler de import.meta.env (Vite) ou process.env (injetado via vite.config.ts)
      const clientVapid = (isVite ? import.meta.env.VITE_VAPID_PUBLIC_KEY : undefined) || (typeof process !== 'undefined' ? process.env.VITE_VAPID_PUBLIC_KEY : undefined);
      const supabaseUrl = (isVite ? import.meta.env.VITE_SUPABASE_URL : undefined) || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);
      
      // Verificação básica de configuração
      if (!supabaseUrl || supabaseUrl === 'your-supabase-url') {
        throw new Error('Supabase URL não configurada');
      }

      const { data, error } = await supabase.functions.invoke('send-notifications', {
        body: { 
          debug: true, 
          clientEnv: { 
            VAPID_PUBLIC_KEY: clientVapid,
            SUPABASE_URL: supabaseUrl
          } 
        }
      });
      
      if (error) throw error;
      return data;
    } catch (err: any) {
      // Diferenciar erro de rede/implantação de erro de lógica
      if (err.message?.includes('Failed to send a request') || err.message?.includes('fetch')) {
        console.warn("Edge Function não encontrada ou inacessível. Certifique-se de que 'send-notifications' está implantada.");
        return { error: 'unreachable', message: err.message };
      }
      console.error("Erro ao verificar VAPID match:", err);
      return null;
    }
  },

  async sendTestNotification(userId: string) {
    try {
      const isVite = typeof import.meta !== 'undefined' && import.meta.env;
      const supabaseUrl = (isVite ? import.meta.env.VITE_SUPABASE_URL : undefined) || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);
      
      // Verificação básica de configuração
      if (!supabaseUrl || supabaseUrl === 'your-supabase-url') {
        throw new Error('Supabase não configurado. Configure as variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
      }

      const { data, error } = await supabase.functions.invoke('send-notifications', {
        body: { test: true, userId }
      });
      
      if (error) {
        console.error("Erro detalhado da Edge Function:", error);
        if (error.status === 401) {
          throw new Error("Não autorizado (401). Verifique se você está logado e se a função foi implantada corretamente.");
        }
        if (error.message?.includes('Failed to send a request')) {
          throw new Error("Não foi possível alcançar a Edge Function. Verifique se ela foi implantada no seu projeto Supabase.");
        }
        throw error;
      }
      return data;
    } catch (err: any) {
      console.error("Erro ao invocar Edge Function:", err);
      throw err;
    }
  },

  async getDebugInfo() {
    try {
      const isVite = typeof import.meta !== 'undefined' && import.meta.env;
      const supabaseUrl = (isVite ? import.meta.env.VITE_SUPABASE_URL : undefined) || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);

      // Verificação básica de configuração
      if (!supabaseUrl || supabaseUrl === 'your-supabase-url') {
        return { error: 'Supabase não configurado' };
      }

      const { data, error } = await supabase.functions.invoke('send-notifications', {
        method: 'GET',
        headers: { 'x-debug-request': 'true' }
      });
      return { data, error };
    } catch (err: any) {
      if (err.message?.includes('Failed to send a request')) {
        return { error: 'Edge Function inacessível. Verifique se ela foi implantada.' };
      }
      return { error: err.message || err };
    }
  },

  async ensureSubscriptionSynced(userId: string) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return null;
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return null;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await pushService.saveSubscription(userId, subscription);
        return subscription;
      } else {
        const isVite = typeof import.meta !== 'undefined' && import.meta.env;
        const vapidPublicKey = (isVite ? import.meta.env.VITE_VAPID_PUBLIC_KEY : undefined) || (typeof process !== 'undefined' ? process.env.VITE_VAPID_PUBLIC_KEY : undefined);
        if (vapidPublicKey) {
          return await subscribeUser(userId, vapidPublicKey);
        }
      }
    } catch (err) {
      console.warn('[Push] Erro ao re-sincronizar assinatura ao abrir o app:', err);
    }
    return null;
  }
};

export const subscribeUser = async (userId: string, vapidPublicKey: string) => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser');
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Permission not granted');
    }

    let subscription = await registration.pushManager.getSubscription();
    
    // Se já existe uma subscrição, vamos verificar se a chave é a mesma.
    // Se as chaves mudaram, precisamos cancelar a antiga e criar uma nova.
    if (subscription) {
      const currentKey = subscription.options.applicationServerKey;
      const newKey = urlBase64ToUint8Array(vapidPublicKey);
      
      // Comparar as chaves (Uint8Array)
      const keysMatch = currentKey && 
        currentKey.byteLength === newKey.byteLength &&
        newKey.every((val, i) => val === new Uint8Array(currentKey)[i]);
        
      if (!keysMatch) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
    
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
    }

    await pushService.saveSubscription(userId, subscription);
    return subscription;
  } catch (error) {
    console.error('Error subscribing to push:', error);
    throw error;
  }
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
