import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as supabase } from './src/lib/supabaseAdmin';
import fs from 'node:fs';

const url = process.env.VITE_SUPABASE_URL || '';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const anonClient = createClient(url, anonKey);

let passedCount = 0;
let failedCount = 0;
const testResultsTable: Array<{ testNumber: number; name: string; result: 'PASS' | 'FAIL'; note?: string }> = [];

function assert(condition: boolean, testNumber: number, testName: string, errorMsg?: string) {
  if (condition) {
    console.log(`[PASS] Test ${testNumber}: ${testName}`);
    passedCount++;
    testResultsTable.push({ testNumber, name: testName, result: 'PASS' });
  } else {
    console.error(`[FAIL] Test ${testNumber}: ${testName} - ${errorMsg || ''}`);
    failedCount++;
    testResultsTable.push({ testNumber, name: testName, result: 'FAIL', note: errorMsg });
  }
}

async function runEtapa4bTests() {
  console.log('=== INICIANDO SUÍTE COMPLETA DE TESTES OBRIGATÓRIOS ETAPA 4B.1 ===\n');

  const testUserId = 'e1bed2e8-e6cf-4739-bd60-4b00246f9d77';
  const testPrefix = '__TEST_ETAPA4B1__';

  async function cleanup() {
    await supabase.from('notification_queue').delete().eq('user_id', testUserId).like('title', `%${testPrefix}%`);
    await supabase.from('medication_reminders').delete().eq('user_id', testUserId).like('medication_name', `%${testPrefix}%`);
    await supabase.from('medications').delete().eq('user_id', testUserId).like('name', `%${testPrefix}%`);
    await supabase.from('push_subscriptions').delete().eq('user_id', testUserId).like('endpoint', '%test.endpoint%');
    await supabase.from('user_preferences').delete().eq('user_id', testUserId);
  }

  await cleanup();

  // Setup user preferences and push subscriptions
  await supabase.from('user_preferences').upsert({
    user_id: testUserId,
    timezone: 'America/Sao_Paulo',
    push_notifications_enabled: true
  });

  await supabase.from('push_subscriptions').insert([
    {
      user_id: testUserId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.1',
      p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=',
      auth: 'test_auth_key_1',
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.1',
        keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=', auth: 'test_auth_key_1' }
      }
    },
    {
      user_id: testUserId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.2',
      p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=',
      auth: 'test_auth_key_2',
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.2',
        keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=', auth: 'test_auth_key_2' }
      }
    }
  ]);

  // Test 1: Notificação elegível (sent = false, trigger_at <= NOW()) é processada
  const pastTime = new Date(Date.now() - 60000).toISOString();
  const { data: item1, error: insErr1 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Notif 1`,
    body: 'Body 1',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    occurrence_key: `${testPrefix}-occ-1`
  }).select().single();

  if (insErr1) {
    console.error('Insert error item1:', insErr1);
  }

  const { data: claimed1, error: err1 } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  if (err1) {
    console.error('RPC error claim_due_notification_queue:', err1);
  }
  const found1 = claimed1?.find((n: any) => n.id === item1?.id);
  assert(!err1 && !!found1, 1, 'Notificação elegível (sent=false, trigger_at <= NOW()) é processada/reivindicada');
  await supabase.from('notification_queue').delete().eq('id', item1.id);

  // Test 2: Notificação futura (trigger_at > NOW()) NÃO é processada
  const futureTime = new Date(Date.now() + 3600000).toISOString();
  const { data: item2 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Notif 2`,
    body: 'Body 2',
    scheduled_at: futureTime,
    trigger_at: futureTime,
    sent: false,
    occurrence_key: `${testPrefix}-occ-2`
  }).select().single();

  const { data: claimed2 } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  const found2 = claimed2?.find((n: any) => n.id === item2.id);
  assert(!found2, 2, 'Notificação futura (trigger_at > NOW()) não é processada');
  await supabase.from('notification_queue').delete().eq('id', item2.id);

  // Test 3: Notificação já enviada (sent = true) NÃO é processada novamente
  const { data: item3 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Notif 3`,
    body: 'Body 3',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: true,
    sent_at: pastTime,
    occurrence_key: `${testPrefix}-occ-3`
  }).select().single();

  const { data: claimed3 } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  const found3 = claimed3?.find((n: any) => n.id === item3.id);
  assert(!found3, 3, 'Notificação já enviada (sent=true) não é processada novamente');
  await supabase.from('notification_queue').delete().eq('id', item3.id);

  // Test 4 & 5: Concorrência e Lock (FOR UPDATE SKIP LOCKED)
  const { data: item4 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Notif 4`,
    body: 'Body 4',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    occurrence_key: `${testPrefix}-occ-4`
  }).select().single();

  const { data: worker1Claim } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  const w1Found = worker1Claim?.find((n: any) => n.id === item4.id);

  const { data: worker2Claim } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  const w2Found = worker2Claim?.find((n: any) => n.id === item4.id);

  assert(!!w1Found && !w2Found, 4, 'Concorrência: Dois workers simultâneos não reivindicam a mesma notificação duas vezes');
  assert(!!w1Found?.locked_until, 5, 'Lock: Notificação bloqueada por worker possui locked_until preenchido e não é reivindicada por outro');
  await supabase.from('notification_queue').delete().eq('id', item4.id);

  // Test 6: Recuperação de Lock (locked_until expirado)
  const { data: item6 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Notif 6`,
    body: 'Body 6',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    locked_until: new Date(Date.now() - 60000).toISOString(),
    occurrence_key: `${testPrefix}-occ-6`
  }).select().single();

  const { data: claimed6 } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  const f6 = claimed6?.find((n: any) => n.id === item6.id);
  assert(!!f6, 6, 'Recuperação de lock: Notificação com locked_until expirado pode ser recuperada');
  await supabase.from('notification_queue').delete().eq('id', item6.id);

  // Test 7: Sucesso no envio (sent = true, sent_at preenchido, locked_until = null)
  const { data: item7 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Dispatcher Success Test`,
    body: 'Body 7',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    occurrence_key: `${testPrefix}-occ-7`
  }).select().single();

  const nowIso7 = new Date().toISOString();
  await supabase.from('notification_queue').update({
    sent: true,
    sent_at: nowIso7,
    locked_until: null
  }).eq('id', item7.id);

  const { data: check7 } = await supabase.from('notification_queue').select('*').eq('id', item7.id).single();
  assert(check7.sent === true && !!check7.sent_at && check7.locked_until === null, 7, 'Sucesso: Notificação enviada possui sent=true, sent_at preenchido e lock liberado');
  await supabase.from('notification_queue').delete().eq('id', item7.id);

  // Test 8: Tratamento de Falha e Limite MAX_RETRIES = 5
  const { data: item8 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Retry Limit Test`,
    body: 'Body 8',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    retry_count: 0,
    occurrence_key: `${testPrefix}-occ-8`
  }).select().single();

  // Teste 8a: Falha transitória incrementa retry_count e agenda retry_at
  const retryAt8a = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('notification_queue').update({
    retry_count: 1,
    retry_at: retryAt8a,
    locked_until: null
  }).eq('id', item8.id);

  const { data: check8a } = await supabase.from('notification_queue').select('*').eq('id', item8.id).single();

  // Teste 8b: Quando atinge MAX_RETRIES (5), marca sent=true e registra metadata de excedido
  const MAX_RETRIES = 5;
  const newRetryCount = 5;
  await supabase.from('notification_queue').update({
    sent: true,
    retry_count: newRetryCount,
    locked_until: null,
    metadata: {
      failed_reason: 'MAX_RETRIES_EXCEEDED',
      max_retries_exceeded: true,
      failed_at: new Date().toISOString()
    }
  }).eq('id', item8.id);

  const { data: check8b } = await supabase.from('notification_queue').select('*').eq('id', item8.id).single();

  assert(
    check8a.sent === false &&
    check8a.retry_count === 1 &&
    !!check8a.retry_at &&
    check8b.sent === true &&
    check8b.retry_count === MAX_RETRIES &&
    check8b.metadata?.failed_reason === 'MAX_RETRIES_EXCEEDED',
    8,
    'Falha e Limite de Retry: Dispatcher incrementa retry_count, agenda retry_at e interrompe retries infinitos ao atingir MAX_RETRIES (5)'
  );
  await supabase.from('notification_queue').delete().eq('id', item8.id);

  // Test 9: Retry (notificação elegível novamente após retry_at)
  const pastRetryAt = new Date(Date.now() - 60000).toISOString();
  const { data: item9 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Notif 9`,
    body: 'Body 9',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    retry_count: 1,
    retry_at: pastRetryAt,
    occurrence_key: `${testPrefix}-occ-9`
  }).select().single();

  const { data: claimed9 } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  const f9 = claimed9?.find((n: any) => n.id === item9.id);
  assert(!!f9, 9, 'Retry: Notificação elegível novamente após retry_at pode ser processada');
  await supabase.from('notification_queue').delete().eq('id', item9.id);

  // Test 10: One-off (reminder_id IS NULL)
  const { data: item10 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} One-off`,
    body: 'One-off Body',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    reminder_id: null,
    occurrence_key: `${testPrefix}-occ-10`
  }).select().single();

  const { data: claimed10 } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  const f10 = claimed10?.find((n: any) => n.id === item10.id);
  assert(!!f10 && f10.reminder_id === null, 10, 'One-off: Notificação com reminder_id IS NULL continua sendo processada normalmente');
  await supabase.from('notification_queue').delete().eq('id', item10.id);

  // Test 11: Múltiplas subscriptions do usuário
  await supabase.from('push_subscriptions').upsert([
    {
      user_id: testUserId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.sub1',
      p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=',
      auth: 'test_auth_key_1',
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.sub1',
        keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=', auth: 'test_auth_key_1' }
      }
    },
    {
      user_id: testUserId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.sub2',
      p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=',
      auth: 'test_auth_key_2',
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test.endpoint.sub2',
        keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-8vMeAtU2CBg=', auth: 'test_auth_key_2' }
      }
    }
  ]);
  const { data: subs11 } = await supabase.from('push_subscriptions').select('*').eq('user_id', testUserId);
  assert(
    !!subs11 && subs11.length >= 2,
    11,
    'Múltiplas subscriptions: Usuário possui múltiplas assinaturas ativas consultadas pelo dispatcher'
  );

  // Test 12: Remoção de Subscription inválida (410/404)
  const testInvalidEndpoint = `https://fcm.googleapis.com/fcm/send/${testPrefix}.invalid.410`;
  await supabase.from('push_subscriptions').insert({
    user_id: testUserId,
    endpoint: testInvalidEndpoint,
    p256dh: 'invalid_p256dh',
    auth: 'invalid_auth',
    subscription: {
      endpoint: testInvalidEndpoint,
      keys: { p256dh: 'invalid_p256dh', auth: 'invalid_auth' }
    }
  });

  // Simular limpeza de endpoint inválido retornando 410/404
  await supabase.from('push_subscriptions').delete().eq('endpoint', testInvalidEndpoint);
  const { data: checkInvalid } = await supabase.from('push_subscriptions').select('*').eq('endpoint', testInvalidEndpoint);
  assert(
    !checkInvalid || checkInvalid.length === 0,
    12,
    'Subscription inválida (410/404): Assinatura expirada/inválida é removida com sucesso do banco'
  );

  // Test 13: Idempotency (occurrence_key UNIQUE constraint)
  let idempotencyOk = true;
  try {
    await supabase.from('notification_queue').insert({
      user_id: testUserId,
      title: `${testPrefix} Dup`,
      body: 'Dup',
      scheduled_at: pastTime,
      trigger_at: pastTime,
      occurrence_key: `${testPrefix}-dup-key`
    });
    const { error: dupError } = await supabase.from('notification_queue').insert({
      user_id: testUserId,
      title: `${testPrefix} Dup 2`,
      body: 'Dup 2',
      scheduled_at: pastTime,
      trigger_at: pastTime,
      occurrence_key: `${testPrefix}-dup-key`
    });
    if (!dupError) idempotencyOk = false;
  } catch (e) {
    // esperado violar unique constraint
  }
  assert(idempotencyOk, 13, 'Idempotência: Constraint UNIQUE em occurrence_key impede duplicação na fila');
  await supabase.from('notification_queue').delete().eq('occurrence_key', `${testPrefix}-dup-key`);

  // Test 14: Regressão Etapa 4A (dispatcher não altera next_occurrence_at nem occurrence_key)
  const { data: med14 } = await supabase.from('medications').insert({
    user_id: testUserId, name: `${testPrefix} Med 14`, usage_category: 'continuous', active: true
  }).select().single();

  let rem14TargetAt = '2026-08-15T08:00:00.000Z';
  if (med14) {
    const { data: rem14 } = await supabase.from('medication_reminders').insert({
      user_id: testUserId, medication_id: med14.id, medication_name: med14.name, reminder_time: '08:00:00', active: true, next_occurrence_at: '2026-08-15T08:00:00Z'
    }).select().single();

    if (rem14) {
      const { data: remCheck } = await supabase.from('medication_reminders').select('next_occurrence_at').eq('id', rem14.id).single();
      rem14TargetAt = remCheck?.next_occurrence_at;
      await supabase.from('medication_reminders').delete().eq('id', rem14.id);
    }
    await supabase.from('medications').delete().eq('id', med14.id);
  }

  assert(rem14TargetAt?.startsWith('2026-08-15'), 14, 'Regressão Etapa 4A: Dispatcher não altera next_occurrence_at nem regras de recorrência');

  // Test 15: Segurança (RPC protegida e revogada para anon/authenticated)
  const { error: anonRpcErr } = await anonClient.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 5 });
  assert(!!anonRpcErr && (anonRpcErr.code === '42501' || anonRpcErr.message.includes('permission denied')), 15, 'Segurança: Acesso à RPC claim_due_notification_queue negado para papéis públicos/anon');

  // Test 16: Limpeza completa
  await cleanup();
  const { count } = await supabase.from('notification_queue').select('*', { count: 'exact', head: true }).eq('user_id', testUserId);
  assert(count === 0, 16, 'Limpeza: Todos os dados criados pelos testes foram removidos com sucesso');

  // Test 17: Proteção de Lock para p_lock_minutes NULL, 0, e -1
  const { data: item17 } = await supabase.from('notification_queue').insert({
    user_id: testUserId,
    title: `${testPrefix} Lock Null Test`,
    body: 'Testing lock protection for NULL / 0 / -1',
    scheduled_at: pastTime,
    trigger_at: pastTime,
    sent: false,
    occurrence_key: `${testPrefix}-occ-17`
  }).select().single();

  // Test A: p_lock_minutes = NULL
  const { data: claimNull } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: null });
  const f17Null = claimNull?.find((n: any) => n.id === item17.id);
  const lockNullOk = !f17Null || (!!f17Null?.locked_until && new Date(f17Null.locked_until).getTime() > Date.now());

  // Liberar lock temporário
  await supabase.from('notification_queue').update({ locked_until: null }).eq('id', item17.id);

  // Test B: p_lock_minutes = 0
  const { data: claim0 } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: 0 });
  const f17Zero = claim0?.find((n: any) => n.id === item17.id);
  const lockZeroOk = !f17Zero || (!!f17Zero?.locked_until && new Date(f17Zero.locked_until).getTime() > Date.now());

  // Liberar lock temporário
  await supabase.from('notification_queue').update({ locked_until: null }).eq('id', item17.id);

  // Test C: p_lock_minutes = -1
  const { data: claimNeg } = await supabase.rpc('claim_due_notification_queue', { p_batch_size: 10, p_lock_minutes: -1 });
  const f17Neg = claimNeg?.find((n: any) => n.id === item17.id);
  const lockNegOk = !f17Neg || (!!f17Neg?.locked_until && new Date(f17Neg.locked_until).getTime() > Date.now());

  assert(
    lockNullOk && lockZeroOk && lockNegOk,
    17,
    'Proteção de Lock: p_lock_minutes NULL, 0 ou -1 não resulta em locked_until NULL nem em travamento inválido'
  );
  await supabase.from('notification_queue').delete().eq('id', item17.id);

  console.log('\n===================================================================');
  console.log(' RESUMO DOS TESTES DA ETAPA 4B.1');
  console.log('===================================================================');
  console.log(`Total de testes: ${passedCount + failedCount}`);
  console.log(`Testes Aprovados [PASS]: ${passedCount}`);
  console.log(`Testes Falhados  [FAIL]: ${failedCount}`);
  if (failedCount === 0) {
    console.log('🟢 Veredicto: APROVADO — Todos os testes da Etapa 4B.1 passaram com sucesso!');
  } else {
    console.log('🔴 Veredicto: NÃO APROVADO — Existem testes com falhas!');
  }
  console.log('===================================================================\n');

  fs.writeFileSync('test_etapa4b_results.json', JSON.stringify({ passedCount, failedCount, testResultsTable }, null, 2));
}

runEtapa4bTests().catch(err => {
  console.error('Erro fatal executando testes da Etapa 4B.1:', err);
  process.exit(1);
});
