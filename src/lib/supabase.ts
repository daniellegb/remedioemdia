import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Access variables statically for Vite compatibility
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check for placeholders or undefined
const isInvalid = (val: string | undefined) => 
  !val || val === 'undefined' || val.includes('your-supabase') || val.includes('TODO');

let supabaseInstance: SupabaseClient;

if (!isInvalid(supabaseUrl) && !isInvalid(supabaseAnonKey)) {
  console.log('Initializing Supabase client with URL:', supabaseUrl);
  supabaseInstance = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'medmanager-v2-auth-token',
      // Custom lock function for sandbox environment
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
} else {
  console.warn('Supabase credentials missing or invalid. Using a dummy client.');
  // Create a dummy client to avoid null checks everywhere, it will fail on actual requests
  supabaseInstance = createClient('https://placeholder.supabase.co', 'placeholder', {
    auth: { persistSession: false }
  });
}

export const supabase = supabaseInstance;

export const isSupabaseConfigured = () => 
  !isInvalid(supabaseUrl) && !isInvalid(supabaseAnonKey);
