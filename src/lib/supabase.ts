import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Adaptador de storage para Capacitor (Web + Mobile)
const capacitorStorageAdapter = {
  getItem: (key: string) => {
    return Preferences.get({ key }).then(result => result.value);
  },
  setItem: (key: string, value: string) => {
    return Preferences.set({ key, value });
  },
  removeItem: (key: string) => {
    return Preferences.remove({ key });
  },
};

// Debug rigoroso no console para identificar se a URL está sendo injetada incorretamente no build
if (import.meta.env.DEV) {
  console.log('[SUPABASE_DEBUG] URL detectada:', supabaseUrl);
}

// Bloqueio de inicialização se a URL for o placeholder conhecido ou inválida
const PLACEHOLDER_ID = 'zugmjotqqoineafwzkpf';
const isPlaceholder = !supabaseUrl || 
                      supabaseUrl.includes(PLACEHOLDER_ID) || 
                      supabaseUrl === 'your-supabase-url' ||
                      !supabaseUrl.startsWith('https://');

// MOCK CLIENT FOR DEMO MODE
// Implementamos uma versão mínima do SupabaseClient para permitir que o app funcione sem backend real
const createMockClient = (): any => {
  const mockAuth = {
    getSession: async () => ({ data: { session: JSON.parse(localStorage.getItem('demo_session') || 'null') }, error: null }),
    signInWithPassword: async ({ email }: any) => {
      const session = { user: { id: 'demo-user', email }, access_token: 'mock', refresh_token: 'mock' };
      localStorage.setItem('demo_session', JSON.stringify(session));
      return { data: { session, user: session.user }, error: null };
    },
    signUp: async ({ email }: any) => {
      const session = { user: { id: 'demo-user', email }, access_token: 'mock', refresh_token: 'mock' };
      localStorage.setItem('demo_session', JSON.stringify(session));
      return { data: { session, user: session.user }, error: null };
    },
    signOut: async () => {
      localStorage.removeItem('demo_session');
      return { error: null };
    },
    onAuthStateChange: (callback: any) => {
      const session = JSON.parse(localStorage.getItem('demo_session') || 'null');
      setTimeout(() => callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session), 0);
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    getUser: async () => ({ data: { user: JSON.parse(localStorage.getItem('demo_session') || 'null')?.user || null }, error: null }),
    signInWithOAuth: async () => {
      const session = { user: { id: 'demo-user', email: 'google-user@demo.com' }, access_token: 'mock', refresh_token: 'mock' };
      localStorage.setItem('demo_session', JSON.stringify(session));
      window.location.href = '/dashboard';
      return { data: { session, user: session.user }, error: null };
    }
  };

  const from = (table: string) => ({
    select: () => ({
      eq: () => ({
        single: async () => {
          if (table === 'profiles') return { data: { id: 'demo-user', email: 'user@demo.com', onboarding_completed: true, role: 'user' }, error: null };
          return { data: null, error: null };
        },
        order: () => ({
          then: (cb: any) => cb({ data: [], error: null })
        })
      }),
      order: () => ({
        then: (cb: any) => cb({ data: [], error: null })
      })
    }),
    insert: () => ({
      select: () => ({
        single: async () => ({ data: {}, error: null })
      })
    }),
    update: () => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: {}, error: null })
        })
      })
    }),
    delete: () => ({
      eq: () => ({ error: null })
    }),
    upsert: () => ({
      select: () => ({
        single: async () => ({ data: {}, error: null })
      })
    })
  });

  return {
    auth: mockAuth,
    from,
    channel: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    removeAllChannels: () => {}
  } as any;
};

let supabaseInstance: SupabaseClient | null = null;
let isDemoMode = false;

if (supabaseUrl && supabaseAnonKey && !isPlaceholder) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: capacitorStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    });
    isDemoMode = false;
  } catch (error) {
    console.error('[SUPABASE] Erro crítico na inicialização:', error);
  }
}

if (!supabaseInstance) {
  const reason = isPlaceholder ? 'URL detectada como PLACEHOLDER incorreto. Entrando em MODO DEMO.' : 'Variáveis ausentes. Entrando em MODO DEMO.';
  console.warn(`[SUPABASE] ${reason}`);
  supabaseInstance = createMockClient() as SupabaseClient;
  isDemoMode = true;
}

// Export pre-initialized client
export const supabase = supabaseInstance;

/**
 * Função utilitária para limpar cache e forçar recarregamento se houver erro de config
 */
export const clearAppCache = async () => {
  localStorage.clear();
  await Preferences.clear();
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
  }
  window.location.reload();
};

export const isSupabaseConfigured = () => !isDemoMode;
export const getIsDemoMode = () => isDemoMode;
