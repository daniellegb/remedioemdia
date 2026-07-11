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

const lockQueues = new Map<string, Promise<any>>();

const customLock = async <R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  if (typeof window === 'undefined') {
    return fn();
  }

  // Ignoramos navigator.locks.request em ambientes de iframe/sandbox/AI Studio para evitar travamento eterno/deadlocks silenciados
  console.log(`[customLock] [REQUISITADO] Trava '${name}' solicitada (usando fila em memória resiliente com timeout de segurança).`);

  const previousPromise = lockQueues.get(name) || Promise.resolve();

  // Cria um timeout de segurança (padrão 5 segundos) para evitar qualquer travamento eterno
  const timeoutMs = acquireTimeout > 0 ? acquireTimeout : 5000;
  let timeoutId: any;
  
  const timeoutPromise = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[customLock] Timeout de aquisição (${timeoutMs}ms) excedido para a trava '${name}'`));
    }, timeoutMs);
  });

  const currentPromise = (async () => {
    try {
      // Aguarda a trava anterior ou o timeout de segurança
      await Promise.race([previousPromise, timeoutPromise]);
    } catch (e: any) {
      console.warn(`[customLock] Espera pela trava anterior '${name}' falhou ou expirou:`, e?.message || e);
      // Prossegue mesmo em caso de erro/timeout para evitar que a aplicação congele para sempre
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    console.log(`[customLock] [EXECUTANDO] Iniciando execução da trava '${name}' de forma exclusiva.`);
    try {
      const result = await fn();
      console.log(`[customLock] [RESOLVIDO] Execução da trava '${name}' concluída.`);
      return result;
    } catch (err: any) {
      console.error(`[customLock] [ERRO] Falha durante execução da trava '${name}':`, err?.message || err);
      throw err;
    }
  })();

  // Registra a nova Promise na fila
  lockQueues.set(name, currentPromise);

  // Limpa a fila quando terminar
  currentPromise.finally(() => {
    if (lockQueues.get(name) === currentPromise) {
      lockQueues.delete(name);
      console.log(`[customLock] [LIBERADO] Trava '${name}' limpa da fila.`);
    }
  });

  return currentPromise;
};

const customFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : (input && 'toString' in input ? input.toString() : (input as any)?.url || 'unknown');
  const method = init?.method || 'GET';
  
  console.log(`[customFetch] [INICIADO] ${method} ${urlStr}`);
  
  const controller = new AbortController();
  let abortListener: (() => void) | undefined;
  
  if (init?.signal) {
    if (init.signal.aborted) {
      console.warn(`[customFetch] [ABORTADO_PREVIAMENTE] ${method} ${urlStr}`);
      controller.abort();
    } else {
      abortListener = () => {
        console.warn(`[customFetch] [ABORTADO_VIA_SINAL] ${method} ${urlStr}`);
        controller.abort();
      };
      init.signal.addEventListener('abort', abortListener);
    }
  }

  // 10 seconds timeout para todas as chamadas de REST/Auth para prevenir hangs infinitos em conexões instáveis
  const timeoutId = setTimeout(() => {
    console.warn(`[customFetch] [TIMEOUT_EXCEDIDO] A requisição para ${urlStr} excedeu o limite de tempo de 10s. Abortando...`);
    controller.abort();
  }, 10000);

  return fetch(input, {
    ...init,
    signal: controller.signal
  })
  .then((response) => {
    console.log(`[customFetch] [SUCESSO] ${method} ${urlStr} - Status: ${response.status}`);
    return response;
  })
  .catch((err) => {
    console.error(`[customFetch] [FALHA] ${method} ${urlStr} - Erro:`, err?.message || err);
    throw err;
  })
  .finally(() => {
    clearTimeout(timeoutId);
    if (init?.signal && abortListener) {
      init.signal.removeEventListener('abort', abortListener);
    }
  });
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
      lock: customLock,
      fetch: customFetch
    } as any,
    global: {
      fetch: customFetch
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
