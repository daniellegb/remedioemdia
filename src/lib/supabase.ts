import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Access variables with fallback to process.env for Vite define compatibility
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

const isInvalid = (val: string) => !val || val === 'undefined' || val.includes('TODO') || val.includes('placeholder');

export const isSupabaseConfigured = () => !isInvalid(SUPABASE_URL) && !isInvalid(SUPABASE_ANON_KEY);

// Diagnostic log
console.log('[Supabase] Initializing with URL:', SUPABASE_URL);

/**
 * Standard client initialization.
 * No fallbacks, no proxies, no custom locks unless proven necessary.
 */
export const supabase = createClient(
  isInvalid(SUPABASE_URL) ? 'https://placeholder.supabase.co' : SUPABASE_URL,
  isInvalid(SUPABASE_ANON_KEY) ? 'placeholder' : SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'medmanager-v2-auth-token'
    }
  }
);

/**
 * Diagnostic tool
 */
export const testSupabaseConnection = async () => {
  if (!isSupabaseConfigured()) return { ok: false, message: 'Configuração ausente (VITE_SUPABASE_URL).' };
  
  try {
    const { data, error } = await supabase.from('medications').select('count').limit(1);
    if (error) throw error;
    return { ok: true, message: 'Conexão estável com o banco de dados.' };
  } catch (err: any) {
    console.error('[Supabase] Connection test failed:', err);
    return { ok: false, message: `Erro de conexão: ${err.message || 'Falha de rede'}` };
  }
};

export const getSupabaseStatus = () => ({
  isConfigured: isSupabaseConfigured(),
  url: SUPABASE_URL,
  keyPrefix: SUPABASE_ANON_KEY ? `${SUPABASE_ANON_KEY.substring(0, 8)}...` : 'MISSING'
});
