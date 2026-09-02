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
const KEY = clean(getEnv('VITE_SUPABASE_PUBLISHABLE_KEY'));

class InMemoryLock {
  private locks = new Map<string, Promise<any>>();

  async acquire<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name);
    
    let resolveLock: () => void;
    const currentLockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    this.locks.set(name, currentLockPromise);

    if (previous) {
      try {
        await previous;
      } catch (e) {
        // Ignore previous lock failures to avoid blocking the queue
      }
    }

    try {
      return await fn();
    } finally {
      resolveLock!();
      if (this.locks.get(name) === currentLockPromise) {
        this.locks.delete(name);
      }
    }
  }
}

const lockManager = new InMemoryLock();

const customLock = async <R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  return lockManager.acquire(name, fn);
};

const customFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : (input && 'toString' in input ? input.toString() : (input as any)?.url || 'unknown');
  
  const controller = new AbortController();
  let abortListener: (() => void) | undefined;
  
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      abortListener = () => {
        controller.abort();
      };
      init.signal.addEventListener('abort', abortListener);
    }
  }

  // 10 seconds timeout for REST/Auth calls to prevent infinite hangs on unstable connections
  const timeoutId = setTimeout(() => {
    console.warn(`[customFetch] A requisição para ${urlStr} excedeu o limite de tempo de 10s e foi abortada.`);
    controller.abort();
  }, 10000);

  return fetch(input, {
    ...init,
    signal: controller.signal
  })
  .catch((err) => {
    console.error(`[customFetch] Falha na requisição para ${urlStr}:`, err?.message || err);
    throw err;
  })
  .finally(() => {
    clearTimeout(timeoutId);
    if (init?.signal && abortListener) {
      init.signal.removeEventListener('abort', abortListener);
    }
  });
};

const rawSupabase = createClient(
  URL || 'https://placeholder.supabase.co',
  KEY || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'med-clean-v3',
      lock: customLock,
      fetch: customFetch
    } as any,
    global: {
      fetch: customFetch
    }
  }
);

export const supabase = rawSupabase;

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
