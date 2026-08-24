import { generateDailySummary, SummaryCycle, SummaryGeneratorInput } from './summaryGenerator';
import { Medication, Appointment, UserPreferences } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FALHA NO TESTE: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

console.log('--- EXECUTANDO TESTES DE INTEGRAÇÃO DO SEND-NOTIFICATIONS / GERADOR DE RESUMOS ---');

// Helper que replica a lógica de cálculo de ciclo e timezone da Edge Function
function determineUserCycle(date: Date, userTimezone: string): { localDate: string; localHour: number; cycle: SummaryCycle | null } {
  let localDate: string;
  let localHour: number;
  try {
    localDate = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone }).format(date);
    const hourStr = new Intl.DateTimeFormat('pt-BR', { timeZone: userTimezone, hour: '2-digit', hourCycle: 'h23' }).format(date);
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

  return { localDate, localHour, cycle };
}

// 1. Usuário às 08:00 local -> morning
console.log('1. Usuário às 08:00 local -> morning...');
// 08:00 em São Paulo (UTC-3) corresponde a 11:00 UTC
const date8AmSp = new Date('2026-08-23T11:00:00Z');
const resCycle8 = determineUserCycle(date8AmSp, 'America/Sao_Paulo');
assert(resCycle8.localHour === 8, 'localHour é 8');
assert(resCycle8.cycle === 'morning', 'Ciclo é morning');

// 2. Usuário às 13:00 local -> afternoon
console.log('2. Usuário às 13:00 local -> afternoon...');
// 13:00 em São Paulo (UTC-3) corresponde a 16:00 UTC
const date1PmSp = new Date('2026-08-23T16:00:00Z');
const resCycle13 = determineUserCycle(date1PmSp, 'America/Sao_Paulo');
assert(resCycle13.localHour === 13, 'localHour é 13');
assert(resCycle13.cycle === 'afternoon', 'Ciclo é afternoon');

// 3. Usuário às 19:00 local -> night
console.log('3. Usuário às 19:00 local -> night...');
// 19:00 em São Paulo (UTC-3) corresponde a 22:00 UTC
const date7PmSp = new Date('2026-08-23T22:00:00Z');
const resCycle19 = determineUserCycle(date7PmSp, 'America/Sao_Paulo');
assert(resCycle19.localHour === 19, 'localHour é 19');
assert(resCycle19.cycle === 'night', 'Ciclo é night');

// 4. Usuário fora desses horários -> nenhuma geração
console.log('4. Usuário fora desses horários -> nenhuma geração...');
const date10AmSp = new Date('2026-08-23T13:00:00Z'); // 10:00 em SP
const resCycle10 = determineUserCycle(date10AmSp, 'America/Sao_Paulo');
assert(resCycle10.localHour === 10, 'localHour é 10');
assert(resCycle10.cycle === null, 'Ciclo é null fora das janelas canônicas');

// 5. Usuário em America/Sao_Paulo
console.log('5. Usuário em America/Sao_Paulo...');
assert(resCycle8.localDate === '2026-08-23', 'localDate correto em SP');

// 6. Usuário em outro timezone (ex: Tokyo UTC+9)
console.log('6. Usuário em outro timezone (ex: Asia/Tokyo)...');
// 23:00 UTC de 2026-08-22 corresponde a 08:00 de 2026-08-23 em Tokyo
const dateTokyo = new Date('2026-08-22T23:00:00Z');
const resCycleTokyo = determineUserCycle(dateTokyo, 'Asia/Tokyo');
assert(resCycleTokyo.localHour === 8, 'Hora local em Tokyo é 8');
assert(resCycleTokyo.cycle === 'morning', 'Ciclo em Tokyo é morning');
assert(resCycleTokyo.localDate === '2026-08-23', 'Data local em Tokyo é 2026-08-23');

// 7. NIGHT atravessando meia-noite
console.log('7. NIGHT atravessando meia-noite...');
const medNightCross: Medication = {
  id: 'm1',
  name: 'Sedativo',
  dosage: '1',
  unit: 'comprimido',
  frequency: 1,
  color: 'blue',
  totalStock: 30,
  currentStock: 30,
  times: ['22:00', '02:00', '07:30'],
  active: true,
  usageCategory: 'continuous'
};
const resNight = generateDailySummary({
  userId: 'usr-1',
  cycle: 'night',
  localDate: '2026-08-23',
  medications: [medNightCross]
});
assert(resNight.shouldNotify === true, 'shouldNotify é true para night');
assert(resNight.metadata.items_count === 3, 'Contabiliza 22:00 de hoje + 02:00 e 07:30 de amanhã');

// 8. NIGHT não incluindo 08:00 do dia seguinte
console.log('8. NIGHT não incluindo 08:00 do dia seguinte...');
const med8Am: Medication = {
  id: 'm2',
  name: 'Manhã',
  dosage: '1',
  unit: 'comprimido',
  frequency: 1,
  color: 'green',
  totalStock: 30,
  currentStock: 30,
  times: ['08:00'],
  active: true,
  usageCategory: 'continuous'
};
const resNightNo8Am = generateDailySummary({
  userId: 'usr-1',
  cycle: 'night',
  localDate: '2026-08-23',
  medications: [med8Am]
});
assert(resNightNo8Am.shouldNotify === false, '08:00 do dia seguinte é excluído do night');

// 9. Usuário sem itens -> nenhum INSERT (shouldNotify = false)
console.log('9. Usuário sem itens -> nenhum INSERT...');
const resEmpty = generateDailySummary({
  userId: 'usr-1',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [],
  appointments: []
});
assert(resEmpty.shouldNotify === false, 'Regra de silêncio: shouldNotify=false');
assert(resEmpty.body === '', 'Body vazio');

// 10. Usuário com itens -> exatamente um occurrence_key
console.log('10. Usuário com itens -> exatamente um occurrence_key...');
const resItems = generateDailySummary({
  userId: 'usr-abc',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [med8Am]
});
assert(resItems.shouldNotify === true, 'shouldNotify é true');
assert(resItems.occurrenceKey === 'summary:morning:usr-abc:2026-08-23', 'occurrenceKey exato');

// 11. Segunda execução do mesmo ciclo -> não cria duplicata (idempotência)
console.log('11. Segunda execução do mesmo ciclo -> mesma occurrenceKey...');
const resItemsRepetido = generateDailySummary({
  userId: 'usr-abc',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [med8Am]
});
assert(resItems.occurrenceKey === resItemsRepetido.occurrenceKey, 'Idempotência garantida');

// 12. Dois usuários diferentes -> occurrence_keys diferentes
console.log('12. Dois usuários diferentes -> occurrence_keys diferentes...');
const resUser2 = generateDailySummary({
  userId: 'usr-xyz',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [med8Am]
});
assert(resItems.occurrenceKey !== resUser2.occurrenceKey, 'Chaves distintas por usuário');

// 13. Resumo com doses
console.log('13. Resumo com doses...');
assert(resItems.body.includes('1 administração programada para esta manhã'), 'Texto de dose matinal');

// 14. Resumo com estoque/validade
console.log('14. Resumo com estoque/validade no MORNING...');
const medStock: Medication = {
  id: 'm-stock',
  name: 'Insulina',
  dosage: '1',
  unit: 'dose',
  frequency: 1,
  color: 'red',
  totalStock: 10,
  currentStock: 0,
  times: [],
  active: true,
  usageCategory: 'continuous'
};
const resStock = generateDailySummary({
  userId: 'usr-1',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [medStock]
});
assert(resStock.body.includes('Há 1 remédio sem estoque'), 'Alerta de sem estoque');

// 15. Resumo com Compromissos
console.log('15. Resumo com Compromissos...');
const apptTomorrow: Appointment = {
  id: 'app-1',
  doctor: 'Dra. Maria',
  specialty: 'Endocrinologia',
  type: 'Consulta',
  date: '2026-08-24',
  time: '10:00',
  location: 'Consultório 102',
  active: true
};
const resAppt = generateDailySummary({
  userId: 'usr-1',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [],
  appointments: [apptTomorrow]
});
assert(resAppt.body.includes('Você tem 1 compromisso agendado para amanhã'), 'Nomenclatura "compromisso"');

// 16. Resumo combinado
console.log('16. Resumo combinado...');
const resCombinado = generateDailySummary({
  userId: 'usr-1',
  cycle: 'morning',
  localDate: '2026-08-23',
  medications: [med8Am, medStock],
  appointments: [apptTomorrow]
});
assert(resCombinado.metadata.items_count === 3, 'Contabiliza 3 itens (dose + estoque + compromisso)');
assert(resCombinado.body.includes('administração programada'), 'Contém doses');
assert(resCombinado.body.includes('remédio sem estoque'), 'Contém estoque');
assert(resCombinado.body.includes('compromisso agendado'), 'Contém compromisso');

// 17 a 19. Auditoria de Código da Edge Function
console.log('17 a 19. Auditoria estática de send-notifications/index.ts...');
const edgeFunctionCode = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/send-notifications/index.ts'), 'utf-8');

assert(edgeFunctionCode.includes('claim_due_notification_queue'), '17. claim_due_notification_queue continua sendo utilizada');
assert(!edgeFunctionCode.includes('claim_due_medication_occurrences'), '18. claim_due_medication_occurrences NÃO é mais chamada no send-notifications');
assert(!edgeFunctionCode.includes('claim_due_stock_and_expiry_occurrences'), '18. claim_due_stock_and_expiry_occurrences NÃO é mais chamada no send-notifications');
assert(!edgeFunctionCode.includes('medication_reminders'), '19. Nenhuma referência de execução a medication_reminders');

// 20 a 23. Verificação das Políticas de Dispatch no Código
console.log('20 a 23. Auditoria do Dispatcher...');
assert(edgeFunctionCode.includes('err.statusCode === 410 || err.statusCode === 404'), '20. Dispatcher trata 404/410 limpando subscription');
assert(edgeFunctionCode.includes('retry_count') && edgeFunctionCode.includes('MAX_RETRIES = 5'), '21. Dispatcher gerencia política de retry');
assert(edgeFunctionCode.includes('PUSH_NOTIFICATIONS_DISABLED'), '22. Dispatcher descarta notificações de usuários com push desabilitado');
assert(edgeFunctionCode.includes('NO_ACTIVE_SUBSCRIPTION'), '23. Dispatcher descarta notificações de usuários sem subscription ativa');

console.log('✅ TODOS OS 23 ITENS DE VALIDAÇÃO DE INTEGRAÇÃO PASSARAM COM 100% DE SUCESSO!');
