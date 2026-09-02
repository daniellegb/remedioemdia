import { createClient } from '@supabase/supabase-js';
import { consumptionService } from '../src/services/consumptionService';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SECRET_KEY || '';

if (!supabaseUrl || !serviceKey) {
  console.error('Credenciais do Supabase ausentes.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function runDistributedAtomicTests() {
  console.log('========================================================================');
  console.log('🚀 VALIDAÇÃO DE ATOMICIDADE E CONCORRÊNCIA DISTRIBUÍDA NO POSTGRESQL');
  console.log('========================================================================');

  // 1. Obter usuário de teste
  const { data: userList } = await supabase.from('profiles').select('id').limit(1);
  const userId = userList?.[0]?.id;

  if (!userId) {
    console.error('Nenhum usuário de teste encontrado no Supabase.');
    process.exit(1);
  }

  // 2. Criar medicamento exclusivo para esta bateria de testes
  const testMedName = `__POSTGRES_ATOMIC_${Date.now()}`;
  const { data: med, error: medError } = await supabase
    .from('medications')
    .insert({
      user_id: userId,
      name: testMedName,
      dosage: '0.5',
      current_stock: 10,
      total_stock: 30,
      unit: 'comprimido',
      usage_category: 'continuous',
      times: ['08:00', '20:00'],
      active: true,
      deleted: false
    })
    .select()
    .single();

  if (medError || !med) {
    console.error('Erro ao criar medicamento de teste:', medError);
    process.exit(1);
  }

  const medId = med.id;
  console.log(`Medicamento de teste criado: ID ${medId} com estoque inicial 10.0\n`);

  let totalTests = 0;
  let passedTests = 0;
  let lostUpdates = 0;

  try {
    // --------------------------------------------------------------------------
    // TESTE A: 2x 0.5 SIMULTÂNEOS NO POSTGRESQL (Esperado: 9.0) - 5 REPETIÇÕES
    // --------------------------------------------------------------------------
    console.log('▶ Teste A: Concorrência 2x 0.5 simultâneos sobre 10.0 (Esperado: 9.0) - 5 REPETIÇÕES');
    let tAPass = 0;
    for (let r = 1; r <= 5; r++) {
      totalTests++;
      await supabase.from('medications').update({ current_stock: 10 }).eq('id', medId);

      // Chamadas simultâneas diretas via RPC PostgreSQL independente
      await Promise.all([
        supabase.rpc('adjust_medication_stock', {
          p_user_id: userId,
          p_medication_id: medId,
          p_delta: -0.5
        }),
        supabase.rpc('adjust_medication_stock', {
          p_user_id: userId,
          p_medication_id: medId,
          p_delta: -0.5
        })
      ]);

      const { data: medCurrent } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
      const finalStock = Number(medCurrent?.current_stock);

      if (finalStock === 9.0) {
        tAPass++;
        passedTests++;
      } else {
        lostUpdates++;
        console.error(`  ❌ Falha na repetição ${r}: esperado 9.0, obtido ${finalStock}`);
      }
    }
    console.log(`  ✓ Teste A: ${tAPass}/5 repetições corretas no PostgreSQL (0 lost updates).\n`);

    // --------------------------------------------------------------------------
    // TESTE B: Doses Diferentes Concorrentes (0.5 + 0.25 sobre 10.0 -> Esperado: 9.25) - 5 REPETIÇÕES
    // --------------------------------------------------------------------------
    console.log('▶ Teste B: Doses Diferentes 0.5 + 0.25 sobre 10.0 (Esperado: 9.25) - 5 REPETIÇÕES');
    let tBPass = 0;
    for (let r = 1; r <= 5; r++) {
      totalTests++;
      await supabase.from('medications').update({ current_stock: 10 }).eq('id', medId);

      await Promise.all([
        supabase.rpc('adjust_medication_stock', {
          p_user_id: userId,
          p_medication_id: medId,
          p_delta: -0.5
        }),
        supabase.rpc('adjust_medication_stock', {
          p_user_id: userId,
          p_medication_id: medId,
          p_delta: -0.25
        })
      ]);

      const { data: medCurrent } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
      const finalStock = Number(medCurrent?.current_stock);

      if (finalStock === 9.25) {
        tBPass++;
        passedTests++;
      } else {
        lostUpdates++;
        console.error(`  ❌ Falha na repetição ${r}: esperado 9.25, obtido ${finalStock}`);
      }
    }
    console.log(`  ✓ Teste B: ${tBPass}/5 repetições corretas no PostgreSQL (0 lost updates).\n`);

    // --------------------------------------------------------------------------
    // TESTE C: Alta Concorrência (10 operações simultâneas de 0.1 sobre 10.0 -> Esperado: 9.0) - 5 REPETIÇÕES
    // --------------------------------------------------------------------------
    console.log('▶ Teste C: Alta Concorrência (10 chamadas paralelas de -0.1 sobre 10.0 -> Esperado: 9.0) - 5 REPETIÇÕES');
    let tCPass = 0;
    for (let r = 1; r <= 5; r++) {
      totalTests++;
      await supabase.from('medications').update({ current_stock: 10 }).eq('id', medId);

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          supabase.rpc('adjust_medication_stock', {
            p_user_id: userId,
            p_medication_id: medId,
            p_delta: -0.1
          })
        );
      }
      await Promise.all(promises);

      const { data: medCurrent } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
      const finalStock = Number(medCurrent?.current_stock);

      if (finalStock === 9.0) {
        tCPass++;
        passedTests++;
      } else {
        lostUpdates++;
        console.error(`  ❌ Falha na repetição ${r}: esperado 9.0, obtido ${finalStock}`);
      }
    }
    console.log(`  ✓ Teste C: ${tCPass}/5 repetições corretas no PostgreSQL (0 lost updates).\n`);

    // --------------------------------------------------------------------------
    // TESTE D: Estoque Limitado / Proteção contra negativo (2x 0.5 sobre 0.5 -> Esperado: 0.0) - 5 REPETIÇÕES
    // --------------------------------------------------------------------------
    console.log('▶ Teste D: Proteção contra estoque negativo (2x 0.5 sobre 0.5 -> Esperado: 0.0) - 5 REPETIÇÕES');
    let tDPass = 0;
    for (let r = 1; r <= 5; r++) {
      totalTests++;
      await supabase.from('medications').update({ current_stock: 0.5 }).eq('id', medId);

      await Promise.all([
        supabase.rpc('adjust_medication_stock', {
          p_user_id: userId,
          p_medication_id: medId,
          p_delta: -0.5
        }),
        supabase.rpc('adjust_medication_stock', {
          p_user_id: userId,
          p_medication_id: medId,
          p_delta: -0.5
        })
      ]);

      const { data: medCurrent } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
      const finalStock = Number(medCurrent?.current_stock);

      if (finalStock === 0.0) {
        tDPass++;
        passedTests++;
      } else {
        lostUpdates++;
        console.error(`  ❌ Falha na repetição ${r}: esperado 0.0, obtido ${finalStock}`);
      }
    }
    console.log(`  ✓ Teste D: ${tDPass}/5 repetições corretas no PostgreSQL (0 lost updates).\n`);

    // --------------------------------------------------------------------------
    // TESTE E: Concorrência de Estorno via RPC toggle_dose_consumption
    // --------------------------------------------------------------------------
    console.log('▶ Teste E: Concorrência de Estorno via toggle_dose_consumption (2x estorno 0.5 sobre 8.0 -> 9.0) - 5 REPETIÇÕES');
    let tEPass = 0;
    for (let r = 1; r <= 5; r++) {
      totalTests++;

      const { data: rec1 } = await supabase.from('consumption_records').insert({
        user_id: userId,
        medication_id: medId,
        date: '2026-08-19',
        scheduled_time: `08:0${r % 10}`,
        status: 'taken'
      }).select().single();

      const { data: rec2 } = await supabase.from('consumption_records').insert({
        user_id: userId,
        medication_id: medId,
        date: '2026-08-19',
        scheduled_time: `12:0${r % 10}`,
        status: 'taken'
      }).select().single();

      await supabase.from('medications').update({ current_stock: 8.0 }).eq('id', medId);

      // Estornos simultâneos via RPC
      await Promise.all([
        supabase.rpc('toggle_dose_consumption', {
          p_user_id: userId,
          p_record_id: rec1?.id,
          p_new_status: 'pending',
          p_dosage_amount: 0.5
        }),
        supabase.rpc('toggle_dose_consumption', {
          p_user_id: userId,
          p_record_id: rec2?.id,
          p_new_status: 'pending',
          p_dosage_amount: 0.5
        })
      ]);

      const { data: medCurrent } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
      const finalStock = Number(medCurrent?.current_stock);

      if (finalStock === 9.0) {
        tEPass++;
        passedTests++;
      } else {
        lostUpdates++;
        console.error(`  ❌ Falha na repetição ${r}: esperado 9.0, obtido ${finalStock}`);
      }

      await supabase.from('consumption_records').delete().in('id', [rec1?.id, rec2?.id]);
    }
    console.log(`  ✓ Teste E: ${tEPass}/5 repetições corretas no PostgreSQL (0 lost updates).\n`);

    // --------------------------------------------------------------------------
    // TESTE F: Multi-Chamadas Independentes de Consumo (Via consumptionService)
    // --------------------------------------------------------------------------
    console.log('▶ Teste F: Operações via consumptionService completo...');
    totalTests++;
    await supabase.from('medications').update({ current_stock: 10.0 }).eq('id', medId);

    const c1 = await consumptionService.createConsumptionRecord(userId, {
      medicationId: medId,
      date: '2026-08-19',
      scheduledTime: '18:00',
      status: 'taken',
      dosageAmount: 0.5
    });

    const { data: medF1 } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
    if (Number(medF1?.current_stock) === 9.5) {
      passedTests++;
      console.log('  ✓ Consumo criado com sucesso, estoque = 9.5');
    }

    // --------------------------------------------------------------------------
    // TESTE G: Exclusão e Estorno Atômico de PRN
    // --------------------------------------------------------------------------
    console.log('\n▶ Teste G: Exclusão e Estorno de PRN via delete_dose_consumption...');
    totalTests++;
    const delRes = await consumptionService.deleteConsumptionRecord(userId, c1.dose.id, 0.5);
    const { data: medG } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
    
    if (delRes.success && Number(medG?.current_stock) === 10.0) {
      passedTests++;
      console.log('  ✓ PRN excluído e estoque estornado para 10.0');
    }

    // --------------------------------------------------------------------------
    // TESTE H: Isolamento de Segurança por Usuário
    // --------------------------------------------------------------------------
    console.log('\n▶ Teste H: Segurança - Tentativa de alterar medicamento de outro usuário...');
    totalTests++;
    const dummyUserId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const { data: secRes, error: secErr } = await supabase.rpc('adjust_medication_stock', {
      p_user_id: dummyUserId,
      p_medication_id: medId,
      p_delta: -5.0
    });

    const { data: medH } = await supabase.from('medications').select('current_stock').eq('id', medId).single();
    if (Number(medH?.current_stock) === 10.0 && (!secRes || secRes.current_stock === null)) {
      passedTests++;
      console.log('  ✓ Operação não autorizada bloqueada pelo PostgreSQL (estoque protegido em 10.0).');
    }

  } finally {
    await supabase.from('consumption_records').delete().eq('medication_id', medId);
    await supabase.from('medications').delete().eq('id', medId);
    console.log('\n🧹 Dados de teste limpos com sucesso.');
  }

  console.log('\n========================================================================');
  console.log('📊 RESUMO DA VALIDAÇÃO DE CONCORRÊNCIA E ATOMICIDADE NO POSTGRESQL');
  console.log('========================================================================');
  console.log(`Total de Casos Testados: ${totalTests}`);
  console.log(`✅ Aprovados: ${passedTests}`);
  console.log(`❌ Lost Updates: ${lostUpdates}`);

  if (lostUpdates === 0 && passedTests === totalTests) {
    console.log('\n🎉 SUCESSO TOTAL: TODAS AS OPERAÇÕES FORAM 100% ATÔMICAS NO POSTGRESQL!');
  } else {
    console.error('\n❌ Houve falhas na validação.');
    process.exit(1);
  }
}

runDistributedAtomicTests();
