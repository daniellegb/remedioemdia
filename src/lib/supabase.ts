import { createClient } from '@supabase/supabase-js';

// Deep clean of environment variables (removing invisible characters)
const clean = (val: any) => typeof val === 'string' ? val.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '';

const getEnv = (key: string) => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
};

const URL = clean(getEnv('VITE_SUPABASE_URL'));
const KEY = clean(getEnv('VITE_SUPABASE_ANON_KEY'));

const isDev = (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.DEV : false) || (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production');

if (isDev) {
  console.log('[Supabase] Rodando em Ambiente de Desenvolvimento');
}

const activeLocks = new Map<string, Promise<any>>();

const customLock = async <R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  if (typeof window === 'undefined') {
    return fn();
  }

  // Use a highly robust in-memory lock to serialize calls within the window/tab context.
  // This avoids Navigator LockManager timeouts which fail inside sandboxed iframes.
  const existingLock = activeLocks.get(name) || Promise.resolve();
  
  let resolveLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });

  activeLocks.set(name, existingLock.then(() => newLock, () => newLock));

  try {
    await existingLock;
    return await fn();
  } finally {
    resolveLock!();
    if (activeLocks.get(name) === newLock) {
      activeLocks.delete(name);
    }
  }
};

export const supabase = createClient(
  URL || 'https://placeholder.supabase.co',
  KEY || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'med-clean-v3',
      lock: customLock
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
