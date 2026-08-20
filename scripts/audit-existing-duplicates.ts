import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceKey) {
  console.error('Credenciais ausentes.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function checkExistingDuplicates() {
  console.log('========================================================================');
  console.log('🔍 AUDITORIA DE DUPLICIDADES EXISTENTES EM consumption_records');
  console.log('========================================================================');

  const { data: records, error } = await supabase
    .from('consumption_records')
    .select('id, user_id, medication_id, date, scheduled_time, status, created_at');

  if (error) {
    console.error('Erro ao ler registros:', error);
    process.exit(1);
  }

  console.log(`Total de registros em consumption_records: ${records?.length || 0}`);

  const seenMap = new Map<string, any[]>();
  for (const r of records || []) {
    const key = `${r.user_id}_${r.medication_id}_${r.date}_${r.scheduled_time}`;
    if (!seenMap.has(key)) {
      seenMap.set(key, []);
    }
    seenMap.get(key)!.push(r);
  }

  let duplicateGroups = 0;
  let totalDuplicateRecords = 0;

  for (const [key, group] of seenMap.entries()) {
    if (group.length > 1) {
      duplicateGroups++;
      totalDuplicateRecords += group.length - 1;
      console.log(`⚠️ Conflito/Duplicidade encontrada para key: ${key}`);
      group.forEach(item => {
        console.log(`   - ID: ${item.id} | Status: ${item.status} | CreatedAt: ${item.created_at}`);
      });
    }
  }

  console.log('------------------------------------------------------------------------');
  console.log(`Grupos com duplicidade: ${duplicateGroups}`);
  console.log(`Total de registros duplicados excedentes: ${totalDuplicateRecords}`);
  console.log('========================================================================');
}

checkExistingDuplicates();
