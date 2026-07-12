import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!url) {
  console.error('VITE_SUPABASE_URL is missing.');
  process.exit(1);
}

async function testWithClient(name: string, keyToUse: string) {
  console.log(`\n--- Testing with ${name} ---`);
  const supabase = createClient(url, keyToUse);

  console.log('Fetching a valid user profile from profiles...');
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, email')
    .limit(1);

  if (profileError) {
    console.error('Error fetching profile:', profileError);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.error('No profiles found in the database. Please make sure at least one user is registered.');
    return;
  }

  const userId = profiles[0].id;
  console.log(`Found user profile: id=${userId}, email=${profiles[0].email}`);

  // Prepare medication data
  const testMed = {
    name: `Test Med ${Date.now()}`,
    dosage: '10mg',
    unit: 'mg',
    usage_category: 'routine',
    doses_per_day: 1,
    times: ['08:00'],
    user_id: userId,
    active: true
  };

  console.log('Inserting medication...');
  const start = Date.now();
  try {
    const { data, error } = await supabase
      .from('medications')
      .insert([testMed])
      .select()
      .single();

    const duration = Date.now() - start;
    if (error) {
      console.error(`Insert failed in ${duration}ms with error:`, error);
    } else {
      console.log(`Insert SUCCEEDED in ${duration}ms! Result:`, data);
      
      // Clean up
      console.log('Cleaning up test medication...');
      const { error: deleteError } = await supabase
        .from('medications')
        .delete()
        .eq('id', data.id);
      if (deleteError) {
        console.error('Cleanup delete failed:', deleteError);
      } else {
        console.log('Cleanup delete succeeded.');
      }
    }
  } catch (err: any) {
    console.error(`Exception during insert after ${Date.now() - start}ms:`, err.message || err);
  }
}

async function main() {
  console.log('Supabase URL:', url);
  console.log('Service Key Length:', serviceKey.length);
  console.log('Anon Key Length:', anonKey.length);

  // Try with Service Role key (runs as admin, bypasses RLS)
  if (serviceKey) {
    await testWithClient('Service Role Key (Admin)', serviceKey);
  }

  // Try with Anon Key
  if (anonKey) {
    await testWithClient('Anon Key (Standard User)', anonKey);
  }
}

main();
