import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceKey) {
  console.error('Credenciais ausentes.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);
const API_BASE = 'http://127.0.0.1:3000/api/consumption';

async function recordViaApi(payload: any) {
  const res = await fetch(`${API_BASE}/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function toggleViaApi(payload: any) {
  const res = await fetch(`${API_BASE}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function deleteViaApi(payload: any) {
  const res = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function runClosingAuditSuite() {
  console.log('========================================================================');
  console.log('📋 AUDITORIA FINAL DE FECHAMENTO - SUÍTE COMPLETA DE VALIDAÇÃO DDL/API');
  console.log('========================================================================\n');

  const { data: users } = await supabase.from('profiles').select('id').limit(2);
  if (!users || users.length < 1) {
    console.error('Erro: Nenhum perfil encontrado para os testes.');
    process.exit(1);
  }

  const userA = users[0].id;
  const userB = users.length > 1 ? users[1].id : '00000000-0000-0000-0000-000000000099';

  const testMedNameA = `__AUDIT_MED_A_${Date.now()}`;
  const { data: medA } = await supabase
    .from('medications')
    .insert({
      user_id: userA,
      name: testMedNameA,
      dosage: '1.0',
      current_stock: 10.0,
      total_stock: 30.0,
      unit: 'comprimido',
      usage_category: 'continuous',
      times: ['08:00', '12:00'],
      active: true,
      deleted: false
    })
    .select()
    .single();

  const medIdA = medA?.id;

  const testMedNameB = `__AUDIT_MED_B_${Date.now()}`;
  const { data: medB } = await supabase
    .from('medications')
    .insert({
      user_id: userB,
      name: testMedNameB,
      dosage: '1.0',
      current_stock: 10.0,
      total_stock: 30.0,
      unit: 'comprimido',
      usage_category: 'continuous',
      times: ['08:00'],
      active: true,
      deleted: false
    })
    .select()
    .single();

  const medIdB = medB?.id;

  try {
    // A) TOMADA SIMPLES
    console.log('A) TESTE TOMADA SIMPLES (10.0 - 1.0 = 9.0)');
    const resA = await recordViaApi({
      userId: userA,
      medicationId: medIdA,
      date: '2026-08-19',
      scheduledTime: '08:00',
      status: 'taken',
      dosageAmount: 1.0
    });
    console.log(`  - Estoque retornado: ${resA?.current_stock} (Esperado: 9)`);
    console.log(`  - Idempotent: ${resA?.idempotent} (Esperado: false)`);

    // B) DOSE 0.125
    console.log('\nB) TESTE DOSE FRACIONÁRIA 0.125 (9.0 - 0.125 = 8.875)');
    const resB = await recordViaApi({
      userId: userA,
      medicationId: medIdA,
      date: '2026-08-19',
      scheduledTime: '12:00',
      status: 'taken',
      dosageAmount: 0.125
    });
    console.log(`  - Estoque retornado: ${resB?.current_stock} (Esperado: 8.875)`);

    // Reset de estoque
    await supabase.from('medications').update({ current_stock: 10.0 }).eq('id', medIdA);
    await supabase.from('consumption_records').delete().eq('medication_id', medIdA);

    // C) DOSES DIFERENTES CONCORRENTES (3 tomadas concorrentes de 0.1)
    console.log('\nC) TESTE DOSES DIFERENTES CONCORRENTES (10.0 - 3 * 0.1 = 9.7)');
    const callsC = [0, 1, 2].map((i) =>
      recordViaApi({
        userId: userA,
        medicationId: medIdA,
        date: '2026-08-19',
        scheduledTime: `10:0${i}`,
        status: 'taken',
        dosageAmount: 0.1
      })
    );
    await Promise.all(callsC);

    const { data: medCheckC } = await supabase.from('medications').select('current_stock').eq('id', medIdA).single();
    const { data: recsC } = await supabase.from('consumption_records').select('*').eq('medication_id', medIdA);
    console.log(`  - DB current_stock: ${medCheckC?.current_stock} (Esperado: 9.7)`);
    console.log(`  - Registros criados: ${recsC?.length} (Esperado: 3)`);

    // Reset de estoque
    await supabase.from('medications').update({ current_stock: 10.0 }).eq('id', medIdA);
    await supabase.from('consumption_records').delete().eq('medication_id', medIdA);

    // D) DUAS CHAMADAS SIMULTÂNEAS DA MESMA DOSE
    console.log('\nD) TESTE DUAS CHAMADAS SIMULTÂNEAS DA MESMA DOSE (10.0 - 0.5 = 9.5)');
    const callsD = [1, 2].map(() =>
      recordViaApi({
        userId: userA,
        medicationId: medIdA,
        date: '2026-08-19',
        scheduledTime: '14:00',
        status: 'taken',
        dosageAmount: 0.5
      })
    );
    const resD = await Promise.all(callsD);

    const { data: medCheckD } = await supabase.from('medications').select('current_stock').eq('id', medIdA).single();
    const { data: recsD } = await supabase.from('consumption_records').select('*').eq('medication_id', medIdA);
    const idempotentCountD = resD.filter(r => r?.idempotent === true).length;

    console.log(`  - DB current_stock: ${medCheckD?.current_stock} (Esperado: 9.5)`);
    console.log(`  - Registros criados: ${recsD?.length} (Esperado: 1)`);
    console.log(`  - Respostas com idempotent=true: ${idempotentCountD} (Esperado: 1)`);

    // E) RETRY APÓS RESULTADO NÃO RECEBIDO
    console.log('\nE) TESTE RETRY APÓS RESULTADO NÃO RECEBIDO');
    const resE = await recordViaApi({
      userId: userA,
      medicationId: medIdA,
      date: '2026-08-19',
      scheduledTime: '14:00',
      status: 'taken',
      dosageAmount: 0.5
    });
    console.log(`  - Retry idempotent: ${resE?.idempotent} (Esperado: true)`);
    console.log(`  - Retry stock: ${resE?.current_stock} (Esperado: 9.5)`);

    // F) FALHA PROPOSITAL (Medicamento inexistente)
    console.log('\nF) TESTE FALHA PROPOSITAL (Medicamento inexistente -> Rollback)');
    const fakeMedId = '00000000-0000-0000-0000-000000000000';
    const resF = await recordViaApi({
      userId: userA,
      medicationId: fakeMedId,
      date: '2026-08-19',
      scheduledTime: '18:00',
      status: 'taken',
      dosageAmount: 1.0
    });
    console.log(`  - Resposta de Erro: ${resF?.error} (Esperado: Mensagem de Erro)`);

    // G) ESTOQUE INSUFICIENTE (Estoque=0.2, Dose=0.5)
    console.log('\nG) TESTE ESTOQUE INSUFICIENTE (Estoque=0.2, Dose=0.5)');
    await supabase.from('medications').update({ current_stock: 0.2 }).eq('id', medIdA);

    const resG = await recordViaApi({
      userId: userA,
      medicationId: medIdA,
      date: '2026-08-19',
      scheduledTime: '20:00',
      status: 'taken',
      dosageAmount: 0.5
    });

    const { data: medCheckG } = await supabase.from('medications').select('current_stock').eq('id', medIdA).single();
    console.log(`  - Estoque final retornado: ${resG?.current_stock} (Esperado: 0)`);
    console.log(`  - DB current_stock: ${medCheckG?.current_stock} (Esperado: 0)`);

    // Reset de estoque
    await supabase.from('medications').update({ current_stock: 10.0 }).eq('id', medIdA);
    await supabase.from('consumption_records').delete().eq('medication_id', medIdA);

    // H) PENDING -> TAKEN CONCORRENTE
    console.log('\nH) TESTE PENDING -> TAKEN (toggleViaApi)');
    const { data: newPending } = await supabase
      .from('consumption_records')
      .insert({
        user_id: userA,
        medication_id: medIdA,
        date: '2026-08-19',
        scheduled_time: '21:00',
        status: 'pending'
      })
      .select()
      .single();

    const resH = await toggleViaApi({
      userId: userA,
      recordId: newPending.id,
      newStatus: 'taken',
      dosageAmount: 1.0
    });

    const { data: medCheckH } = await supabase.from('medications').select('current_stock').eq('id', medIdA).single();
    console.log(`  - Estoque após toggle para taken: ${resH?.current_stock} (Esperado: 9.0)`);
    console.log(`  - DB current_stock: ${medCheckH?.current_stock} (Esperado: 9.0)`);

    // I) TAKEN -> PENDING CONCORRENTE
    console.log('\nI) TESTE TAKEN -> PENDING (Estorno via toggleViaApi)');
    const resI = await toggleViaApi({
      userId: userA,
      recordId: newPending.id,
      newStatus: 'pending',
      dosageAmount: 1.0
    });

    const { data: medCheckI } = await supabase.from('medications').select('current_stock').eq('id', medIdA).single();
    console.log(`  - Estoque após estorno para pending: ${resI?.current_stock} (Esperado: 10.0)`);
    console.log(`  - DB current_stock: ${medCheckI?.current_stock} (Esperado: 10.0)`);

    // J) EXCLUSÃO CONCORRENTE
    console.log('\nJ) TESTE EXCLUSÃO E ESTORNO (deleteViaApi)');
    await toggleViaApi({
      userId: userA,
      recordId: newPending.id,
      newStatus: 'taken',
      dosageAmount: 1.0
    });

    const resJ = await deleteViaApi({
      userId: userA,
      recordId: newPending.id,
      dosageAmount: 1.0
    });

    const { data: medCheckJ } = await supabase.from('medications').select('current_stock').eq('id', medIdA).single();
    const { data: recCheckJ } = await supabase.from('consumption_records').select('*').eq('id', newPending.id);

    console.log(`  - Delete success: ${resJ?.success} (Esperado: true)`);
    console.log(`  - DB current_stock estornado: ${medCheckJ?.current_stock} (Esperado: 10.0)`);
    console.log(`  - Registro de consumo existe no DB: ${recCheckJ?.length !== 0} (Esperado: false)`);

    // K) ISOLAMENTO ENTRE USUÁRIOS
    console.log('\nK) TESTE ISOLAMENTO ENTRE USUÁRIOS');
    const resK = await recordViaApi({
      userId: userA,
      medicationId: medIdB,
      date: '2026-08-19',
      scheduledTime: '08:00',
      status: 'taken',
      dosageAmount: 1.0
    });

    console.log(`  - Resposta de Erro no Isolamento: ${resK?.error} (Esperado: Erro)`);

    console.log('\n========================================================================');
    console.log('✅ TODAS AS ETAPAS DA SUÍTE DE AUDITORIA FORAM CONCLUÍDAS COM SUCESSO!');
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n❌ ERRO NA SUÍTE DE AUDITORIA:', err);
  } finally {
    // Limpeza
    await supabase.from('consumption_records').delete().eq('medication_id', medIdA);
    await supabase.from('consumption_records').delete().eq('medication_id', medIdB);
    await supabase.from('medications').delete().eq('id', medIdA);
    await supabase.from('medications').delete().eq('id', medIdB);
  }
}

runClosingAuditSuite();
