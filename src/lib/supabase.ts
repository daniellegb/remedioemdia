import { createClient } from '@supabase/supabase-js';

// Deep clean of environment variables (removing invisible characters)
const clean = (val: any) => typeof val === 'string' ? val.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '';

const URL = clean(typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : process.env.VITE_SUPABASE_URL);
const KEY = clean(typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : process.env.VITE_SUPABASE_ANON_KEY);

const isDev = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.DEV : process.env.NODE_ENV !== 'production';

if (isDev) {
  console.log('[Supabase] Rodando em Ambiente de Desenvolvimento');
}

export const supabase = createClient(
  URL || 'https://placeholder.supabase.co',
  KEY || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'med-clean-v3'
    }
  }
);

// Global debug tool for the user
if (typeof window !== 'undefined') {
  (window as any).supabaseStatus = () => {
    return {
      url: URL,
      keyLength: KEY.length,
      isConfigured: !!URL && URL.includes('supabase.co'),
      origin: window.location.origin
    };
  };
}

export const isSupabaseConfigured = () => !!URL && URL.includes('supabase.co');

export const testSupabaseConnection = async () => {
  try {
    const { error } = await supabase.from('medications').select('count', { count: 'exact', head: true });
    if (error) throw error;
    return { ok: true, message: 'Conexão restabelecida!' };
  } catch (err: any) {
    console.error('[Supabase Test Error]', err);
    return { ok: false, message: err.message || 'Falha na rede' };
  }
};

export const getSupabaseStatus = () => ({
  isConfigured: isSupabaseConfigured(),
  url: URL
});
