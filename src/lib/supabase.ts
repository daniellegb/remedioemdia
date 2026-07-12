import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------
// TELEMETRY LOG BUFFER AND TRANSMITTER FOR THE SERVER LOGS
// ---------------------------------------------------------
if (typeof window !== 'undefined') {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  let logBuffer: string[] = [];
  let isSending = false;
  let sendTimeout: any = null;

  const flushLogs = () => {
    if (logBuffer.length === 0 || isSending) return;
    isSending = true;
    const batch = [...logBuffer];
    logBuffer = [];

    fetch('/api/debug/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: batch })
    })
      .catch((err) => {
        // Safe fallback - don't recurse into console.error to avoid infinite loop
        originalError('[Telemetry Error] Failed to send logs to server:', err.message);
      })
      .finally(() => {
        isSending = false;
        if (logBuffer.length > 0) {
          scheduleFlush(100);
        }
      });
  };

  const scheduleFlush = (delay = 300) => {
    if (sendTimeout) clearTimeout(sendTimeout);
    sendTimeout = setTimeout(flushLogs, delay);
  };

  const addLogToBuffer = (type: string, args: any[]) => {
    try {
      const timestamp = new Date().toISOString();
      const serializedArgs = args.map(arg => {
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}\nStack:\n${arg.stack}`;
        }
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch (e) {
            return '[Unserializable Object]';
          }
        }
        return String(arg);
      }).join(' ');
      
      logBuffer.push(`[FRONTEND-${type.toUpperCase()}] [${timestamp}] ${serializedArgs}`);
      
      // Flush immediately on errors or important logs, or when buffer is large
      if (type === 'error' || logBuffer.length >= 20) {
        flushLogs();
      } else {
        scheduleFlush();
      }
    } catch (e) {
      // Avoid throwing in the intercepted console methods
    }
  };

  console.log = function(...args: any[]) {
    originalLog.apply(console, args);
    addLogToBuffer('log', args);
  };

  console.warn = function(...args: any[]) {
    originalWarn.apply(console, args);
    addLogToBuffer('warn', args);
  };

  console.error = function(...args: any[]) {
    originalError.apply(console, args);
    addLogToBuffer('error', args);
  };

  // Ensure logs are flushed when navigating away
  window.addEventListener('beforeunload', () => {
    if (logBuffer.length > 0) {
      const payload = JSON.stringify({ logs: logBuffer });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/debug/logs', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/debug/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    }
  });
}

// High-fidelity event listener instrumentation for focus and visibilitychange
if (typeof window !== 'undefined') {
  const originalAddEventListener = window.addEventListener;
  window.addEventListener = function(type: string, listener: any, options?: any) {
    if (type === 'focus' || type === 'visibilitychange') {
      const wrappedListener = function(this: any, ...args: any[]) {
        const callId = Math.random().toString(36).substring(2, 7);
        const stack = new Error().stack || '';
        const timestamp = new Date().toISOString();
        console.log(`[TRACE-EVENT] [${callId}] [${timestamp}] EVENTO '${type}' DISPARADO em window. Stack de registro:`, stack.split('\n').slice(2, 5).map(l => l.trim()).join(' -> '));
        const start = Date.now();
        try {
          const res = listener.apply(this, args);
          if (res instanceof Promise) {
            console.log(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' retornou uma Promise.`);
            return res.then(
              (val) => {
                console.log(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' Promise RESOLVIDA em ${Date.now() - start}ms.`);
                return val;
              },
              (err) => {
                console.error(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' Promise REJEITADA em ${Date.now() - start}ms. Erro:`, err);
                throw err;
              }
            );
          } else {
            console.log(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' concluído de forma síncrona em ${Date.now() - start}ms.`);
          }
          return res;
        } catch (err) {
          console.error(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' lançou erro síncrono em ${Date.now() - start}ms:`, err);
          throw err;
        }
      };
      if (listener && !listener.__wrapped) {
        listener.__wrapped = wrappedListener;
      }
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  const originalRemoveEventListener = window.removeEventListener;
  window.removeEventListener = function(type: string, listener: any, options?: any) {
    if (type === 'focus' || type === 'visibilitychange') {
      const target = listener?.__wrapped || listener;
      return originalRemoveEventListener.call(this, type, target, options);
    }
    return originalRemoveEventListener.call(this, type, listener, options);
  };
}

if (typeof document !== 'undefined') {
  const originalAddEventListener = document.addEventListener;
  document.addEventListener = function(type: string, listener: any, options?: any) {
    if (type === 'focus' || type === 'visibilitychange') {
      const wrappedListener = function(this: any, ...args: any[]) {
        const callId = Math.random().toString(36).substring(2, 7);
        const stack = new Error().stack || '';
        const timestamp = new Date().toISOString();
        console.log(`[TRACE-EVENT] [${callId}] [${timestamp}] EVENTO '${type}' DISPARADO em document. Stack de registro:`, stack.split('\n').slice(2, 5).map(l => l.trim()).join(' -> '));
        const start = Date.now();
        try {
          const res = listener.apply(this, args);
          if (res instanceof Promise) {
            console.log(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' no document retornou uma Promise.`);
            return res.then(
              (val) => {
                console.log(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' no document Promise RESOLVIDA em ${Date.now() - start}ms.`);
                return val;
              },
              (err) => {
                console.error(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' no document Promise REJEITADA em ${Date.now() - start}ms. Erro:`, err);
                throw err;
              }
            );
          } else {
            console.log(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' no document concluído de forma síncrona em ${Date.now() - start}ms.`);
          }
          return res;
        } catch (err) {
          console.error(`[TRACE-EVENT] [${callId}] Callback do evento '${type}' no document lançou erro síncrono em ${Date.now() - start}ms:`, err);
          throw err;
        }
      };
      if (listener && !listener.__wrapped) {
        listener.__wrapped = wrappedListener;
      }
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  const originalRemoveEventListener = document.removeEventListener;
  document.removeEventListener = function(type: string, listener: any, options?: any) {
    if (type === 'focus' || type === 'visibilitychange') {
      const target = listener?.__wrapped || listener;
      return originalRemoveEventListener.call(this, type, target, options);
    }
    return originalRemoveEventListener.call(this, type, listener, options);
  };
}

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

class InMemoryLock {
  private locks = new Map<string, Promise<any>>();
  private lockCounters = new Map<string, number>();
  private activeLocks = new Set<string>();

  async acquire<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const acquireStart = Date.now();
    const counter = (this.lockCounters.get(name) || 0) + 1;
    this.lockCounters.set(name, counter);
    const lockId = `${name}#${counter}`;

    const stack = new Error().stack || '';
    const stackLines = stack.split('\n').slice(2, 5).map(l => l.trim()).join(' -> ');

    console.log(`[InMemoryLock] [ENTRADA] [${lockId}] Solicitando trava. Ativos no momento: ${Array.from(this.activeLocks).join(', ') || 'Nenhum'}. Stack: ${stackLines}`);

    const previous = this.locks.get(name);
    
    let resolveLock: () => void;
    const currentLockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    this.locks.set(name, currentLockPromise);

    if (previous) {
      console.log(`[InMemoryLock] [AGUARDANDO] [${lockId}] Há uma trava anterior ativa para '${name}'. Iniciando espera...`);
      const waitStart = Date.now();
      try {
        await previous;
        console.log(`[InMemoryLock] [ESPERA_CONCLUIDA] [${lockId}] Trava anterior para '${name}' resolvida após ${Date.now() - waitStart}ms.`);
      } catch (e: any) {
        console.warn(`[InMemoryLock] [ESPERA_ERRO] [${lockId}] Trava anterior para '${name}' rejeitada após ${Date.now() - waitStart}ms. Erro:`, e?.message || e);
      }
    } else {
      console.log(`[InMemoryLock] [LIVRE] [${lockId}] Sem trava anterior ativa para '${name}'. Prosseguindo imediatamente.`);
    }

    this.activeLocks.add(lockId);
    const fnStart = Date.now();
    console.log(`[InMemoryLock] [EXECUÇÃO_INICIADA] [${lockId}] Iniciando execução do callback protegido.`);

    try {
      const res = await fn();
      console.log(`[InMemoryLock] [EXECUÇÃO_SUCESSO] [${lockId}] Callback protegido concluído em ${Date.now() - fnStart}ms.`);
      return res;
    } catch (err: any) {
      console.error(`[InMemoryLock] [EXECUÇÃO_ERRO] [${lockId}] Callback protegido falhou em ${Date.now() - fnStart}ms. Erro:`, err?.message || err);
      throw err;
    } finally {
      this.activeLocks.delete(lockId);
      resolveLock!();
      console.log(`[InMemoryLock] [LIBERANDO] [${lockId}] Trava liberada (resolveLock chamado).`);
      
      if (this.locks.get(name) === currentLockPromise) {
        this.locks.delete(name);
        console.log(`[InMemoryLock] [LIMPEZA] [${lockId}] Referência de trava para '${name}' removida do Map.`);
      }
    }
  }
}

const lockManager = new InMemoryLock();

const customLock = async <R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  console.log(`[customLock] [REQUISITADO] Trava '${name}' solicitada (timeout: ${acquireTimeout}ms).`);
  const start = Date.now();
  try {
    const res = await lockManager.acquire(name, fn);
    console.log(`[customLock] [SUCESSO] Trava '${name}' concluída com sucesso em ${Date.now() - start}ms.`);
    return res;
  } catch (err: any) {
    console.error(`[customLock] [FALHA] Trava '${name}' falhou em ${Date.now() - start}ms:`, err?.message || err);
    throw err;
  }
};

const customFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : (input && 'toString' in input ? input.toString() : (input as any)?.url || 'unknown');
  const method = init?.method || 'GET';
  const fetchId = Math.random().toString(36).substring(2, 7);
  
  console.log(`[customFetch] [INICIADO] [${fetchId}] ${method} ${urlStr}`);
  
  const controller = new AbortController();
  let abortListener: (() => void) | undefined;
  
  if (init?.signal) {
    if (init.signal.aborted) {
      console.warn(`[customFetch] [ABORTADO_PREVIAMENTE] [${fetchId}] ${method} ${urlStr}`);
      controller.abort();
    } else {
      abortListener = () => {
        console.warn(`[customFetch] [ABORTADO_VIA_SINAL] [${fetchId}] ${method} ${urlStr}`);
        controller.abort();
      };
      init.signal.addEventListener('abort', abortListener);
    }
  }

  // 10 seconds timeout para todas as chamadas de REST/Auth para prevenir hangs infinitos em conexões instáveis
  const timeoutId = setTimeout(() => {
    console.warn(`[customFetch] [TIMEOUT_EXCEDIDO] [${fetchId}] A requisição para ${urlStr} excedeu o limite de tempo de 10s. Abortando...`);
    controller.abort();
  }, 10000);

  const start = Date.now();
  return fetch(input, {
    ...init,
    signal: controller.signal
  })
  .then((response) => {
    console.log(`[customFetch] [SUCESSO] [${fetchId}] ${method} ${urlStr} - Status: ${response.status} em ${Date.now() - start}ms`);
    return response;
  })
  .catch((err) => {
    console.error(`[customFetch] [FALHA] [${fetchId}] ${method} ${urlStr} - Erro após ${Date.now() - start}ms:`, err?.message || err);
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
