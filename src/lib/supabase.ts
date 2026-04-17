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
const isPlaceholder = supabaseUrl?.includes('zugmjotqqoineafwzkpf') || !supabaseUrl?.startsWith('https://');

let supabaseInstance: SupabaseClient | null = null;

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
  } catch (error) {
    console.error('[SUPABASE] Erro crítico na inicialização:', error);
  }
} else {
  const reason = isPlaceholder ? 'URL detectada como PLACEHOLDER incorreto.' : 'Variáveis ausentes no ambiente.';
  console.error(`[SUPABASE] Falha de Configuração: ${reason}`);
}

// Export a proxy or a getter to handle missing instance gracefully
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!supabaseInstance) {
      throw new Error(
        'Supabase client is not initialized. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment variables.'
      );
    }
    return (supabaseInstance as any)[prop];
  }
});

export const isSupabaseConfigured = () => !!supabaseInstance;
