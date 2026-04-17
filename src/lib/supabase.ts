import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_ANON_KEY : undefined);

let supabaseInstance: SupabaseClient | null = null;
const isPlaceholder = (val: string | undefined) => !val || val.includes('your-supabase') || val.includes('TODO');

if (supabaseUrl && supabaseAnonKey && !isPlaceholder(supabaseUrl) && !isPlaceholder(supabaseAnonKey)) {
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
