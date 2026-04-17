import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'medmanager-auth'
    }
  }
);

export const isSupabaseConfigured = () => {
  return SUPABASE_URL && SUPABASE_URL !== 'undefined' && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'undefined';
};

export const testSupabaseConnection = async () => {
  try {
    const { data, error } = await supabase.from('medications').select('count', { count: 'exact', head: true });
    if (error) throw error;
    return { ok: true, message: 'Conectado.' };
  } catch (err: any) {
    if (err.message?.includes('fetch')) {
      return { ok: false, message: 'Erro de conexão/CORS. Verifique o status do Supabase.' };
    }
    return { ok: false, message: err.message };
  }
};

export const getSupabaseStatus = () => ({
  isConfigured: isSupabaseConfigured(),
  url: SUPABASE_URL
});
