import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * ULTRA-STRICT ENVIRONMENT SANITIZATION
 * Cleaning hidden characters, spaces, and validating URL structure.
 */
const cleanEnvVar = (val: any): string | undefined => {
  if (typeof val !== 'string') return undefined;
  // Remove all whitespace, including newlines and hidden characters
  const cleaned = val.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!cleaned || cleaned === 'undefined' || cleaned.includes('your-supabase') || cleaned.includes('TODO')) {
    return undefined;
  }
  return cleaned;
};

const SUPABASE_URL = cleanEnvVar(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON_KEY = cleanEnvVar(import.meta.env.VITE_SUPABASE_ANON_KEY);

const validateConfig = () => {
  const errors: string[] = [];
  
  if (!SUPABASE_URL) {
    errors.push('VITE_SUPABASE_URL está ausente ou inválida.');
  } else {
    try {
      new URL(SUPABASE_URL);
    } catch (e) {
      errors.push(`VITE_SUPABASE_URL não é uma URL válida: "${SUPABASE_URL}"`);
    }
  }

  if (!SUPABASE_ANON_KEY) {
    errors.push('VITE_SUPABASE_ANON_KEY está ausente ou inválida.');
  }

  if (errors.length > 0) {
    console.error('❌ ERRO DE CONFIGURAÇÃO SUPABASE:\n' + errors.join('\n'));
    return false;
  }
  return true;
};

const IS_CONFIGURED = validateConfig();

export const supabase = IS_CONFIGURED 
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'medmanager-v2-auth-token',
        lock: async (_name, _acquireTimeout, callback) => {
          return await callback();
        }
      }
    })
  : new Proxy({} as SupabaseClient, {
      get() {
        throw new Error('Supabase client accessed but NOT configured.');
      }
    });

export const isSupabaseConfigured = () => IS_CONFIGURED;

/**
 * Diagnostic tool to check if the specific Supabase project is reachable via DNS.
 */
export const testSupabaseConnection = async (): Promise<{ ok: boolean; message: string; status?: number }> => {
  if (!IS_CONFIGURED) return { ok: false, message: 'Configuração ausente.' };
  
  try {
    // Attempt to fetch the health endpoint (which is public in Supabase)
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (response.ok) {
      return { ok: true, message: 'Conexão estabelecida com sucesso!' };
    }
    return { ok: false, message: `O servidor respondeu com erro: ${response.status}`, status: response.status };
  } catch (err: any) {
    console.error('Connection test failed:', err);
    if (err.name === 'AbortError') return { ok: false, message: 'Tempo de conexão esgotado (Timeout).' };
    if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      return { ok: false, message: 'Erro de DNS ou Rede (ERR_NAME_NOT_RESOLVED). Verifique se o ID do projeto no Supabase está correto ou se o projeto não foi excluído/pausado.' };
    }
    return { ok: false, message: `Erro desconhecido: ${err.message}` };
  }
};

export const getSupabaseStatus = () => ({
  isConfigured: IS_CONFIGURED,
  url: SUPABASE_URL || 'MISSING',
  keyPrefix: SUPABASE_ANON_KEY ? `${SUPABASE_ANON_KEY.substring(0, 8)}...` : 'MISSING'
});
