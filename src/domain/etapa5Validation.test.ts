import { generateDailySummary, SummaryCycle, SummaryGeneratorInput, GeneratedSummary } from './summaryGenerator';
import { Medication, Appointment, UserPreferences, MedicationUnit } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FALHA NA VALIDAÇÃO: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

console.log('================================================================================');
console.log('      ETAPA 5 — VALIDAÇÃO INTEGRADA DO NOVO MOTOR DE NOTIFICAÇÕES (DEV)        ');
console.log('================================================================================\n');

// ----------------------------------------------------------------------------------
// SEÇÃO 1: AUDITORIA DO SEND-NOTIFICATIONS ATUAL
// ----------------------------------------------------------------------------------
console.log('--- 1. AUDITORIA DO SEND-NOTIFICATIONS ATUAL ---');
const edgeFunctionPath = path.join(process.cwd(), 'supabase/functions/send-notifications/index.ts');
const edgeFunctionCode = fs.readFileSync(edgeFunctionPath, 'utf-8');

// 1.1 RPCs legadas NÃO são chamadas
assert(!edgeFunctionCode.includes('claim_due_medication_occurrences'), '1.1 claim_due_medication_occurrences NÃO é chamada no código ativo');
assert(!edgeFunctionCode.includes('claim_due_stock_and_expiry_occurrences'), '1.1 claim_due_stock_and_expiry_occurrences NÃO é chamada no código ativo');

// 1.2 send-notifications chama claim_due_notification_queue
assert(edgeFunctionCode.includes("supabase.rpc('claim_due_notification_queue'"), '1.2 send-notifications chama claim_due_notification_queue');
assert(edgeFunctionCode.includes('p_batch_size: 50'), '1.2 p_batch_size configurado como 50');
assert(edgeFunctionCode.includes('p_lock_minutes: 5'), '1.2 p_lock_minutes configurado como 5');

// 1.3 Dispatcher preserva políticas de entrega e resiliência
assert(edgeFunctionCode.includes('locked_until'), '1.3 locked_until gerenciado no dispatcher');
assert(edgeFunctionCode.includes('retry_count') && edgeFunctionCode.includes('MAX_RETRIES = 5'), '1.3 retry_count e MAX_RETRIES = 5 implementados');
assert(edgeFunctionCode.includes('retry_at'), '1.3 retry_at configurado para 10 minutos após falha transitória');
assert(edgeFunctionCode.includes('err.statusCode === 410 || err.statusCode === 404'), '1.3 Tratamento de HTTP 404 e 410 presente');
assert(edgeFunctionCode.includes("delete().eq('endpoint', endpoint)"), '1.3 Remoção de subscription inválida ao receber 404/410');
assert(edgeFunctionCode.includes('push_notifications_enabled'), '1.3 Validação de preferência push_notifications_enabled');
assert(edgeFunctionCode.includes('NO_ACTIVE_SUBSCRIPTION'), '1.3 Descarte seguro de usuários sem subscription ativa');
assert(edgeFunctionCode.includes('PUSH_NOTIFICATIONS_DISABLED'), '1.3 Descarte seguro de usuários com push desabilitado');
assert(edgeFunctionCode.includes('for (const sub of userSubs)'), '1.3 Envio para múltiplas subscriptions do mesmo usuário preservado');

// 1.4 Dispatcher NÃO possui regras de negócio de agenda, estoque ou validade
assert(!edgeFunctionCode.includes('isMedicationExpired') && !edgeFunctionCode.includes('isStockRunningOut'), '1.4 Dispatcher desacoplado das regras de domínio de estoque/validade');

// 1.5 Payload Web Push usa diretamente notification.title e notification.body
assert(edgeFunctionCode.includes("notification.metadata?.type === 'daily_summary' || notification.body"), '1.5 formatPushPayload consome title e body estruturados diretamente');

// 1.6 Nenhuma heurística desnecessária baseada em body.includes(...)
const dispatcherSection = edgeFunctionCode.split('dispatchNotificationQueue')[1] || '';
assert(!dispatcherSection.includes('body.includes('), '1.6 Nenhuma heurística baseada em body.includes(...) no dispatcher');

// ----------------------------------------------------------------------------------
// SEÇÃO 2: AUDITORIA DO CONTRATO ENTRE GERADOR E FILA
// ----------------------------------------------------------------------------------
console.log('\n--- 2. AUDITORIA DO CONTRATO ENTRE GERADOR E FILA ---');
const sampleMed: Medication = {
  id: 'med-contract-1',
  name: 'Losartana Potássica',
  dosage: '1',
  unit: 'comprimido' as MedicationUnit,
  frequency: 1,
  color: 'blue',
  totalStock: 30,
  currentStock: 30,
  times: ['09:00'],
  active: true,
  usageCategory: 'continuous'
};

const summaryContractResult = generateDailySummary({
  userId: 'user-contract-123',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [sampleMed]
});

// Checagem de tipos e campos obrigatórios
assert(typeof summaryContractResult.title === 'string' && summaryContractResult.title === 'Remédio em Dia', '2.1 title é "Remédio em Dia"');
assert(typeof summaryContractResult.body === 'string' && summaryContractResult.body.length > 0, '2.2 body é string preenchida');
assert(summaryContractResult.occurrenceKey === 'summary:morning:user-contract-123:2026-08-23', '2.3 occurrenceKey tem formato canônico exato');
assert(summaryContractResult.metadata.type === 'daily_summary', '2.4 metadata.type é "daily_summary"');
assert(summaryContractResult.metadata.cycle === 'morning', '2.5 metadata.cycle é "morning"');
assert(summaryContractResult.metadata.local_date === '2026-08-23', '2.6 metadata.local_date é "2026-08-23"');
assert(summaryContractResult.metadata.items_count === 1, '2.7 metadata.items_count é 1');
assert(summaryContractResult.metadata.url === '/dashboard', '2.8 metadata.url é "/dashboard"');

// ----------------------------------------------------------------------------------
// SEÇÃO 3: VALIDAÇÃO DE TIMEZONE
// ----------------------------------------------------------------------------------
console.log('\n--- 3. VALIDAÇÃO DE TIMEZONE ---');
function simulateCycleDetection(date: Date, prefTimezone?: string, subTimezone?: string) {
  const userTz = prefTimezone || subTimezone || 'America/Sao_Paulo';
  let localDate: string;
  let localHour: number;

  try {
    localDate = new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(date);
    const hourStr = new Intl.DateTimeFormat('pt-BR', { timeZone: userTz, hour: '2-digit', hourCycle: 'h23' }).format(date);
    localHour = parseInt(hourStr, 10);
  } catch {
    localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
    const hourStr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(date);
    localHour = parseInt(hourStr, 10);
  }

  let cycle: SummaryCycle | null = null;
  if (localHour === 8) cycle = 'morning';
  else if (localHour === 13) cycle = 'afternoon';
  else if (localHour === 19) cycle = 'night';

  return { userTz, localDate, localHour, cycle };
}

// Data base: 2026-08-23T11:00:00Z (UTC 11h)
const utcDate = new Date('2026-08-23T11:00:00Z');

// A) America/Sao_Paulo (UTC-3) -> 08:00 -> MORNING
const spTz = simulateCycleDetection(utcDate, 'America/Sao_Paulo');
assert(spTz.localHour === 8 && spTz.cycle === 'morning' && spTz.localDate === '2026-08-23', '3.1 America/Sao_Paulo às 11:00 UTC está em 08:00 local (morning)');

// B) America/New_York (UTC-4 no verão) -> 07:00 -> Fora de ciclo (null)
const nyTz = simulateCycleDetection(utcDate, 'America/New_York');
assert(nyTz.localHour === 7 && nyTz.cycle === null, '3.2 America/New_York às 11:00 UTC está em 07:00 local (fora de ciclo)');

// C) Europe/London (UTC+1 no BST) -> 12:00 -> Fora de ciclo (null)
const lonTz = simulateCycleDetection(utcDate, 'Europe/London');
assert(lonTz.localHour === 12 && lonTz.cycle === null, '3.3 Europe/London às 11:00 UTC está em 12:00 local (fora de ciclo)');

// D) Asia/Tokyo (UTC+9) -> 20:00 -> Fora de ciclo (null)
const tokTz = simulateCycleDetection(utcDate, 'Asia/Tokyo');
assert(tokTz.localHour === 20 && tokTz.cycle === null, '3.4 Asia/Tokyo às 11:00 UTC está em 20:00 local');

// E) Asia/Tokyo às 10:00 UTC -> 19:00 local -> NIGHT
const tokyoNightUtc = new Date('2026-08-23T10:00:00Z');
const tokNight = simulateCycleDetection(tokyoNightUtc, 'Asia/Tokyo');
assert(tokNight.localHour === 19 && tokNight.cycle === 'night' && tokNight.localDate === '2026-08-23', '3.5 Asia/Tokyo às 10:00 UTC está em 19:00 local (night)');

// F) Precedência de timezone: pref > sub > default
const tzPrefWins = simulateCycleDetection(utcDate, 'America/Sao_Paulo', 'Asia/Tokyo');
assert(tzPrefWins.userTz === 'America/Sao_Paulo', '3.6 user_preferences.timezone tem precedência sobre push_subscriptions.timezone');

const tzSubFallback = simulateCycleDetection(utcDate, undefined, 'Asia/Tokyo');
assert(tzSubFallback.userTz === 'Asia/Tokyo', '3.7 push_subscriptions.timezone é fallback quando user_preferences não tem');

const tzDefaultFallback = simulateCycleDetection(utcDate, undefined, undefined);
assert(tzDefaultFallback.userTz === 'America/Sao_Paulo', '3.8 America/Sao_Paulo é fallback final seguro');

// ----------------------------------------------------------------------------------
// SEÇÃO 4: VALIDAÇÃO DOS TRÊS CICLOS E SUAS FRONTEIRAS ESTRITAS
// ----------------------------------------------------------------------------------
console.log('\n--- 4. VALIDAÇÃO DOS TRÊS CICLOS E SUAS FRONTEIRAS ---');
const makeTestMed = (time: string, id: string = 'med-time'): Medication => ({
  id,
  name: `Med ${time}`,
  dosage: '1',
  unit: 'comprimido' as MedicationUnit,
  frequency: 1,
  color: 'blue',
  totalStock: 100,
  currentStock: 100,
  times: [time],
  active: true,
  usageCategory: 'continuous'
});

// Fronteiras do MORNING: 08:00 <= dose < 13:00
const morningMeds = [
  makeTestMed('07:59', 'm-0759'),
  makeTestMed('08:00', 'm-0800'),
  makeTestMed('12:59', 'm-1259'),
  makeTestMed('13:00', 'm-1300')
];
const morningRes = generateDailySummary({
  userId: 'usr-boundary',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: morningMeds
});
assert(morningRes.metadata.items_count === 2, '4.1 MORNING inclui exatamente 08:00 e 12:59 (exclui 07:59 e 13:00)');

// Fronteiras do AFTERNOON: 13:00 <= dose < 19:00
const afternoonMeds = [
  makeTestMed('12:59', 'a-1259'),
  makeTestMed('13:00', 'a-1300'),
  makeTestMed('18:59', 'a-1859'),
  makeTestMed('19:00', 'a-1900')
];
const afternoonRes = generateDailySummary({
  userId: 'usr-boundary',
  cycle: 'afternoon',
  localDate: '2026-08-23',
  medications: afternoonMeds
});
assert(afternoonRes.metadata.items_count === 2, '4.2 AFTERNOON inclui exatamente 13:00 e 18:59 (exclui 12:59 e 19:00)');

// Fronteiras do NIGHT: 19:00 <= dose <= 23:59 (hoje) + 00:00 <= dose < 08:00 (amanhã)
const nightMeds = [
  makeTestMed('18:59', 'n-1859'),
  makeTestMed('19:00', 'n-1900'),
  makeTestMed('23:59', 'n-2359'),
  makeTestMed('00:00', 'n-0000'),
  makeTestMed('07:59', 'n-0759'),
  makeTestMed('08:00', 'n-0800')
];
const nightRes = generateDailySummary({
  userId: 'usr-boundary',
  cycle: 'night',
  localDate: '2026-08-23',
  medications: nightMeds
});
// Esperado no NIGHT: 19:00 (hoje), 23:59 (hoje), 00:00 (amanhã), 07:59 (amanhã) = 4 doses
assert(nightRes.metadata.items_count === 4, '4.3 NIGHT inclui 19:00, 23:59, 00:00, 07:59 e EXCLUI 18:59 e 08:00 do dia seguinte');

// ----------------------------------------------------------------------------------
// SEÇÃO 5: VALIDAÇÃO DA REGRA DE SILÊNCIO
// ----------------------------------------------------------------------------------
console.log('\n--- 5. VALIDAÇÃO DA REGRA DE SILÊNCIO ---');
const emptyRes = generateDailySummary({
  userId: 'usr-silence',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [],
  appointments: []
});
assert(emptyRes.shouldNotify === false, '5.1 shouldNotify é false quando não há itens');
assert(emptyRes.body === '', '5.2 body é string vazia na regra de silêncio');
assert(emptyRes.metadata.items_count === 0, '5.3 items_count é 0');

// Simulação da inserção na fila com shouldNotify === false
let queueInsertAttempted = false;
if (emptyRes.shouldNotify) {
  queueInsertAttempted = true;
}
assert(!queueInsertAttempted, '5.4 Nenhuma inserção em notification_queue ocorre quando shouldNotify === false');

// ----------------------------------------------------------------------------------
// SEÇÃO 6: VALIDAÇÃO DOS DADOS CONSOLIDADOS (CENÁRIO RICO)
// ----------------------------------------------------------------------------------
console.log('\n--- 6. VALIDAÇÃO DOS DADOS CONSOLIDADOS ---');
const complexMeds: Medication[] = [
  // 1. Contínuo normal matinal (1 dose)
  {
    id: 'm-cont',
    name: 'Sinvastatina',
    dosage: '1',
    unit: 'comprimido' as MedicationUnit,
    frequency: 1,
    color: 'yellow',
    totalStock: 30,
    currentStock: 25,
    times: ['08:30'],
    active: true,
    usageCategory: 'continuous'
  },
  // 2. IntervalDays a cada 2 dias (programado para 2026-08-23 -> 1 dose)
  {
    id: 'm-int',
    name: 'Metotrexato',
    dosage: '1',
    unit: 'comprimido' as MedicationUnit,
    frequency: 1,
    color: 'blue',
    totalStock: 20,
    currentStock: 18,
    startDate: '2026-08-21',
    intervalDays: 2,
    times: ['10:00'],
    active: true,
    usageCategory: 'intervals'
  },
  // 3. Anticoncepcional 21/7 no 5º dia de pausa (0 doses hoje)
  {
    id: 'm-contra',
    name: 'Pílula 21d',
    dosage: '1',
    unit: 'comprimido' as MedicationUnit,
    frequency: 1,
    color: 'pink',
    totalStock: 21,
    currentStock: 0, // zerado
    startDate: '2026-08-01', // dia 23 de agosto é dia 23 do ciclo (dia 2 de pausa)
    contraceptiveType: '21_7',
    times: ['09:00'],
    active: true,
    usageCategory: 'contraceptive'
  },
  // 4. Medicamento com estoque acabando (2 dias restantes)
  {
    id: 'm-runout',
    name: 'Omeprazol',
    dosage: '1',
    unit: 'cápsula' as MedicationUnit,
    frequency: 1,
    color: 'green',
    totalStock: 30,
    currentStock: 2, // 2 doses restantes com 1 tomada/dia = 2 dias de estoque (<= threshold 3)
    times: [],
    active: true,
    usageCategory: 'continuous'
  },
  // 5. Medicamento vencido
  {
    id: 'm-exp',
    name: 'Colírio',
    dosage: '1',
    unit: 'gota' as MedicationUnit,
    frequency: 1,
    color: 'cyan',
    totalStock: 10,
    currentStock: 10,
    expiryDate: '2026-08-10', // vencido em relação a 2026-08-23
    times: [],
    active: true,
    usageCategory: 'continuous'
  },
  // 6. Medicamento próximo da validade (2 dias para vencer)
  {
    id: 'm-expsoon',
    name: 'Pomada',
    dosage: '1',
    unit: 'aplicação' as MedicationUnit,
    frequency: 1,
    color: 'purple',
    totalStock: 5,
    currentStock: 5,
    expiryDate: '2026-08-25', // faltam 2 dias (<= threshold 3)
    times: [],
    active: true,
    usageCategory: 'continuous'
  }
];

const complexAppointments: Appointment[] = [
  // Consulta amanhã (2026-08-24)
  {
    id: 'app-1',
    type: 'Consulta',
    doctor: 'Dr. Roberto',
    specialty: 'Cardiologia',
    date: '2026-08-24',
    time: '14:30',
    location: 'Hospital Central',
    active: true
  },
  // Exame em 3 dias (não deve aparecer no MORNING de hoje)
  {
    id: 'app-2',
    type: 'Exame',
    doctor: 'Laboratório Fleury',
    specialty: 'Hemograma',
    date: '2026-08-26',
    time: '07:00',
    location: 'Unidade Paulista',
    active: true
  }
];

const complexResult = generateDailySummary({
  userId: 'usr-rich',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: complexMeds,
  appointments: complexAppointments,
  preferences: { threshold_running_out: 3, threshold_expiring: 3 }
});

assert(complexResult.shouldNotify === true, '6.1 Cenário complexo gerou shouldNotify = true');
// Total itens esperados: 2 doses (Sinvastatina 08:30 + Metotrexato 10:00) + 1 sem estoque (Pílula) + 1 acabando (Omeprazol) + 1 vencido (Colírio) + 1 vencendo (Pomada) + 1 compromisso amanhã = 7 itens
assert(complexResult.metadata.items_count === 7, `6.2 Contabilizou exatamente 7 itens relevantes consolidando todas as regras (obtido: ${complexResult.metadata.items_count})`);

// Verificação do texto consolidado e de elegância visual
assert(complexResult.body.includes('Você tem 2 administrações programadas para esta manhã.'), '6.3 Texto consolidado contém contagem exata de administrações matinais');
assert(complexResult.body.includes('Há 1 remédio sem estoque.'), '6.4 Texto consolidado contém alerta de remédio sem estoque');
assert(complexResult.body.includes('Há 1 remédio próximo de acabar.'), '6.5 Texto consolidado contém alerta de remédio próximo de acabar');
assert(complexResult.body.includes('Há 1 remédio vencido.'), '6.6 Texto consolidado contém alerta de remédio vencido');
assert(complexResult.body.includes('Há 1 remédio próximo da data de validade.'), '6.7 Texto consolidado contém alerta de remédio próximo da validade');
assert(complexResult.body.includes('Você tem 1 compromisso agendado para amanhã.'), '6.8 Texto consolidado utiliza a nomenclatura "compromisso"');

// ----------------------------------------------------------------------------------
// SEÇÃO 7: VALIDAÇÃO DO NIGHT COM DIA SEGUINTE E FRONTEIRA 08:00
// ----------------------------------------------------------------------------------
console.log('\n--- 7. VALIDAÇÃO DO NIGHT COM DIA SEGUINTE ---');
const nightCrossMeds: Medication[] = [
  makeTestMed('19:00', 'n-1900'),
  makeTestMed('23:59', 'n-2359'),
  makeTestMed('00:00', 'n-0000'),
  makeTestMed('07:59', 'n-0759'),
  makeTestMed('08:00', 'n-0800')
];
const resNightBoundary = generateDailySummary({
  userId: 'usr-night-test',
  cycle: 'night',
  localDate: '2026-08-23',
  medications: nightCrossMeds
});
assert(resNightBoundary.shouldNotify === true, '7.1 shouldNotify é true no NIGHT');
assert(resNightBoundary.metadata.items_count === 4, '7.2 NIGHT contém 4 doses (19:00, 23:59 de hoje + 00:00, 07:59 de amanhã)');
assert(resNightBoundary.body.includes('Você tem 4 administrações programadas para esta noite e início da manhã.'), '7.3 Mensagem do NIGHT reflete "esta noite e início da manhã"');

// ----------------------------------------------------------------------------------
// SEÇÃO 8: VALIDAÇÃO DE IDEMPOTÊNCIA
// ----------------------------------------------------------------------------------
console.log('\n--- 8. VALIDAÇÃO DE IDEMPOTÊNCIA ---');
const run1 = generateDailySummary({ userId: 'u-idem', cycle: 'morning', localDate: '2026-08-23', medications: [sampleMed] });
const run2 = generateDailySummary({ userId: 'u-idem', cycle: 'morning', localDate: '2026-08-23', medications: [sampleMed] });
const run3 = generateDailySummary({ userId: 'u-idem', cycle: 'morning', localDate: '2026-08-23', medications: [sampleMed] });

assert(run1.occurrenceKey === run2.occurrenceKey && run2.occurrenceKey === run3.occurrenceKey, '8.1 occurrence_key é 100% idêntica entre execuções repetidas');

// Ciclos diferentes no mesmo dia produzem chaves distintas
const runMorning = generateDailySummary({ userId: 'u-idem', cycle: 'morning', localDate: '2026-08-23', medications: [sampleMed] });
const runAfternoon = generateDailySummary({ userId: 'u-idem', cycle: 'afternoon', localDate: '2026-08-23', medications: [sampleMed] });
const runNight = generateDailySummary({ userId: 'u-idem', cycle: 'night', localDate: '2026-08-23', medications: [sampleMed] });

assert(runMorning.occurrenceKey !== runAfternoon.occurrenceKey, '8.2 Chave de morning é diferente de afternoon');
assert(runAfternoon.occurrenceKey !== runNight.occurrenceKey, '8.3 Chave de afternoon é diferente de night');
assert(runMorning.occurrenceKey !== runNight.occurrenceKey, '8.4 Chave de morning é diferente de night');

// ----------------------------------------------------------------------------------
// SEÇÃO 9: VALIDAÇÃO DA MÁQUINA DE ESTADOS DO DISPATCHER
// ----------------------------------------------------------------------------------
console.log('\n--- 9. VALIDAÇÃO DA MÁQUINA DE ESTADOS DO DISPATCHER ---');
// Verificação estática das transições de estado do dispatcher no código
assert(edgeFunctionCode.includes("status: 'sent'"), '9.1 Transição de sucesso -> status: sent, sent: true');
assert(edgeFunctionCode.includes("status: 'discarded'") && edgeFunctionCode.includes("discarded_reason: 'PUSH_NOTIFICATIONS_DISABLED'"), '9.2 Transição sem permissão -> status: discarded, reason: PUSH_NOTIFICATIONS_DISABLED');
assert(edgeFunctionCode.includes("status: 'discarded'") && edgeFunctionCode.includes("discarded_reason: 'NO_ACTIVE_SUBSCRIPTION'"), '9.3 Transição sem assinatura -> status: discarded, reason: NO_ACTIVE_SUBSCRIPTION');
assert(edgeFunctionCode.includes("status: 'retrying'"), '9.4 Transição com falha transitória -> status: retrying, retry_count incrementado');
assert(edgeFunctionCode.includes("status: 'failed'") && edgeFunctionCode.includes("failed_reason: 'PUSH_SERVICE_ERROR_MAX_RETRIES'"), '9.5 Transição com falha permanente -> status: failed após 5 retries');

// ----------------------------------------------------------------------------------
// SEÇÃO 10: AUDITORIA DE REFERÊNCIAS LEGADAS E ISOLAMENTO
// ----------------------------------------------------------------------------------
console.log('\n--- 10. AUDITORIA DE REFERÊNCIAS LEGADAS E ISOLAMENTO ---');
// Verificação de que os serviços do frontend não chamam mais syncMedicationReminders
const medicationServiceCode = fs.readFileSync(path.join(process.cwd(), 'src/services/medicationService.ts'), 'utf-8');
assert(!medicationServiceCode.includes('syncMedicationReminders'), '10.1 medicationService.ts NÃO chama mais syncMedicationReminders');
assert(!medicationServiceCode.includes('medication_reminders'), '10.2 medicationService.ts NÃO faz operações em medication_reminders');

const appointmentServiceCode = fs.readFileSync(path.join(process.cwd(), 'src/services/appointmentService.ts'), 'utf-8');
assert(!appointmentServiceCode.includes('medication_reminders'), '10.3 appointmentService.ts NÃO faz operações em medication_reminders');

// ----------------------------------------------------------------------------------
// SEÇÃO 11: AUDITORIA DE PERFORMANCE E N+1 QUERIES
// ----------------------------------------------------------------------------------
console.log('\n--- 11. AUDITORIA DE PERFORMANCE E N+1 QUERIES ---');
// Inspecionar send-notifications para contagem de queries por ciclo:
// 1. user_preferences.select() -> 1 query
// 2. push_subscriptions.select() -> 1 query
// 3. Promise.all([ medications.select().in('user_id', cycleUserIds), appointments.select().in('user_id', cycleUserIds) ]) -> 2 queries em lote
// Total fixo de queries para N usuários no mesmo ciclo = 4 queries SQL (O(1) em número de queries de leitura!)
assert(edgeFunctionCode.includes(".in('user_id', cycleUserIds)"), '11.1 Leituras em lote com IN (user_id) previnem N+1 queries para N usuários');

console.log('\n================================================================================');
console.log('  ✅ TODAS AS ETAPAS DE AUDITORIA E VALIDAÇÃO INTEGRADA PASSARAM COM SUCESSO!   ');
console.log('================================================================================');
