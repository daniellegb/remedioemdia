import { createClient, SupabaseClient } from '@supabase/supabase-js';

const clean = (val: any) => typeof val === 'string' ? val.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '';

const getEnv = (key: string) => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  return undefined;
};

const URL = clean(getEnv('VITE_SUPABASE_URL'));
const SERVICE_KEY = clean(getEnv('SUPABASE_SECRET_KEY')) || clean(getEnv('SUPABASE_SERVICE_ROLE_KEY'));

export const supabaseAdmin: SupabaseClient = createClient(
  URL || 'https://placeholder.supabase.co',
  SERVICE_KEY || 'placeholder'
);
