import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * STRICT ENVIRONMENT VALIDATION
 * No silent fallbacks allowed. The app must fail fast if configuration is missing.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isPlaceholder = (val: string | undefined) => 
  !val || 
  val === 'undefined' || 
  val === '' ||
  val.includes('your-supabase') || 
  val.includes('TODO');

// Validation Logic - Run during module initialization
const validateConfig = () => {
  const errors: string[] = [];
  
  if (isPlaceholder(SUPABASE_URL)) {
    errors.push('VITE_SUPABASE_URL is missing or contains a placeholder value.');
  } else {
    try {
      new URL(SUPABASE_URL!);
    } catch (e) {
      errors.push(`VITE_SUPABASE_URL is not a valid URL: ${SUPABASE_URL}`);
    }
  }

  if (isPlaceholder(SUPABASE_ANON_KEY)) {
    errors.push('VITE_SUPABASE_ANON_KEY is missing or contains a placeholder value.');
  }

  if (errors.length > 0) {
    console.error('❌ SUPABASE CONFIGURATION ERROR:\n' + errors.join('\n'));
    return false;
  }
  return true;
};

const IS_CONFIGURED = validateConfig();

// Initialize client only if valid
export const supabase = IS_CONFIGURED 
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'medmanager-v2-auth-token',
        lock: async (_name, _acquireTimeout, callback) => {
          // No-op lock for restrictive environments (iframes/sandboxes)
          return await callback();
        }
      }
    })
  : new Proxy({} as SupabaseClient, {
      get() {
        throw new Error(
          'Supabase client accessed but NOT configured. Check your environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).'
        );
      }
    });

export const isSupabaseConfigured = () => IS_CONFIGURED;

/**
 * Diagnostic helper to verify Supabase connection
 * Does NOT leak the full anon key for security.
 */
export const getSupabaseStatus = () => ({
  isConfigured: IS_CONFIGURED,
  url: SUPABASE_URL || 'MISSING',
  keyPrefix: SUPABASE_ANON_KEY ? `${SUPABASE_ANON_KEY.substring(0, 8)}...` : 'MISSING',
  timestamp: new Date().toISOString()
});
