import { createClient, SupabaseClient } from '@supabase/supabase-js';

const getEnv = (key: string) => {
  const val = import.meta.env[key] || (typeof process !== 'undefined' ? process.env[key] : undefined);
  return typeof val === 'string' ? val.trim() : undefined;
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY');

let supabaseInstance: SupabaseClient | null = null;
const isPlaceholder = (val: string | undefined) => !val || val.includes('your-supabase') || val.includes('TODO') || val === 'undefined';

if (supabaseUrl && supabaseAnonKey && !isPlaceholder(supabaseUrl) && !isPlaceholder(supabaseAnonKey)) {
  console.log('Initializing Supabase client with URL:', supabaseUrl);
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'medmanager-v2-auth-token',
        // Providing a custom lock function to avoid Navigator LockManager timeouts
        // which can happen in restrictive iframe environments like the Build preview.
        // The signature is (name, acquireTimeout, callback)
        lock: async (_name: string, _acquireTimeout: number, callback: () => Promise<any>) => {
          try {
            return await callback();
          } catch (e) {
            console.error('Supabase lock error:', e);
            throw e;
          }
        }
      },
      global: {
        fetch: (url, options) => {
          return fetch(url, options).catch(err => {
            if (err instanceof Error && (err.message === 'Failed to fetch' || err.name === 'TypeError')) {
              console.error('Network error detected in Supabase client:', err);
              // Provide a more descriptive error for the user
              throw new Error('Erro de conexão ao Supabase (Failed to fetch). Verifique se a URL do projeto está correta e se você tem conexão com a internet.');
            }
            throw err;
          });
        }
      }
    });
  } catch (error) {
    console.error('Error initializing Supabase client:', error);
  }
} else {
  if (isPlaceholder(supabaseUrl) || isPlaceholder(supabaseAnonKey)) {
    console.warn('Supabase is using placeholder credentials. Please set real VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  } else {
    console.warn('Supabase credentials missing.');
  }
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
