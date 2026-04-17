import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_ANON_KEY : undefined);

// Adaptador de storage para Capacitor (Web + Mobile)
const capacitorStorageAdapter = {
  getItem: (key: string) => {
    return Preferences.get({ key }).then(result => result.value);
  },
  setItem: (key: string, value: string) => {
    return Preferences.set({ key, value });
  },
  removeItem: (key: string) => {
    return Preferences.remove({ key });
  },
};

let supabaseInstance: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: capacitorStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false // Desativamos pois cuidamos disso manualmente no callback/mobile
      }
    });
  } catch (error) {
    console.error('Error initializing Supabase client:', error);
  }
} else {
  console.warn('Supabase credentials missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
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
