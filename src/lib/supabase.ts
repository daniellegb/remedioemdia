import { createClient } from '@supabase/supabase-js';

/**
 * Robust Environment Extraction
 * Ensures variables are trimmed and visible to the client.
 */
const getEnv = (key: string) => {
  const val = import.meta.env[key] || (typeof process !== 'undefined' ? process.env[key] : '');
  return typeof val === 'string' ? val.trim() : '';
};

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL');
const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY');

const isInvalid = (val: string) => 
  !val || 
  val === 'undefined' || 
  val.includes('TODO') || 
  val.includes('placeholder') || 
  val.includes('your-project');

export const isSupabaseConfigured = () => !isInvalid(SUPABASE_URL) && !isInvalid(SUPABASE_ANON_KEY);

// Log configuration status safely (not the full key)
console.log('[Supabase] Init URL:', SUPABASE_URL || 'MISSING');
console.log('[Supabase] Auth Configured:', isSupabaseConfigured());

/**
 * Standard Supabase client initialization.
 */
export const supabase = createClient(
  isSupabaseConfigured() ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isSupabaseConfigured() ? SUPABASE_ANON_KEY : 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'remedio-em-dia-auth-v1'
    }
  }
);

/**
 * Deep Connection Diagnostics
 * Identifies if the issue is DNS, CORS, or a Paused Project.
 */
export const testSupabaseConnection = async () => {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Falta configurar as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY na Vercel.' };
  }
  
  try {
    const startTime = Date.now();
    // Test 1: Public Health API
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: 'GET' });
    const duration = Date.now() - startTime;

    if (response.ok) {
      return { ok: true, message: `Conectado! Latência: ${duration}ms` };
    }

    return { 
      ok: false, 
      message: `O servidor respondeu com status ${response.status}. Isso geralmente ocorre se o projeto for pausado ou a cota de usuários for atingida.` 
    };
  } catch (err: any) {
    console.error('[Supabase Diagnostics] Connection error:', err);
    
    // Check for DNS failure (NXDOMAIN)
    const errStr = String(err);
    if (errStr.includes('NetworkError') || errStr.includes('TypeError') || errStr.includes('Aborted')) {
      return { 
        ok: false, 
        message: 'ERRO DE DNS/REDE: O navegador não conseguiu encontrar o servidor. Verifique se o seu projeto Supabase está ATIVO (não pausado) e se o URL está 100% correto.' 
      };
    }
    
    return { ok: false, message: `Falha de rede: ${err.message || 'Sem resposta do servidor'}` };
  }
};

// Tool for manual browser console testing
if (typeof window !== 'undefined') {
  (window as any).debugSupabase = async () => {
    console.log('--- Fazendo teste de rede direto para o Supabase ---');
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
      console.log('Status do Health Check:', res.status, res.statusText);
    } catch(e) {
      console.error('Falha crítica de rede no navegador:', e);
      console.warn('Isso sugere que o domínio .supabase.co está inacessível ou o projeto foi pausado.');
    }
  };
}

export const getSupabaseStatus = () => ({
  isConfigured: isSupabaseConfigured(),
  url: SUPABASE_URL,
  keyValid: SUPABASE_ANON_KEY.length > 20
});
