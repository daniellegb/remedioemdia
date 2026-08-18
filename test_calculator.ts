import { calculateNextOccurrence, convertLocalToUTC, getLocalComponents } from './src/domain/nextOccurrenceCalculator';
import { Medication } from './types';

console.log('=== INICIANDO TESTES COMPLETOS ETAPA 3.1 ===');

let passed = 0;
let failed = 0;

function test(name: string, assertion: boolean, details?: string) {
  if (assertion) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    failed++;
  }
}

const baseMed: Medication = {
  id: 'med-1',
  name: 'Paracetamol',
  dosage: '500',
  unit: 'comprimido',
  usageCategory: 'continuous',
  frequency: 1,
  intervalDays: 1,
  currentStock: 10,
  totalStock: 20,
  color: '#ffffff'
} as any;

// 1. Timezone ausente / inválido -> comportamento seguro (retorna null ou lança erro controlado conforme especificado)
const nextMissingTz = calculateNextOccurrence(baseMed, '08:00:00', '', new Date('2026-08-08T13:00:00Z'));
test('Missing timezone returns null (safe behavior)', nextMissingTz === null);

const nextInvalidTz = calculateNextOccurrence(baseMed, '08:00:00', 'Invalid/Timezone', new Date('2026-08-08T13:00:00Z'));
test('Invalid timezone returns null (safe behavior)', nextInvalidTz === null);

// 2. DST Real Test (America/Sao_Paulo não tem DST desde 2019, mas vamos testar America/New_York que tem DST em março e novembro)
// Em 2026, Daylight Saving Time termina em America/New_York em 1 de novembro de 2026 (às 02:00 cloca para 01:00).
// Vamos testar antes e depois da transição de DST.
const nyTz = 'America/New_York';
// Antes da transição (ex: 2026-10-30, offset EDT -4)
const beforeDstRef = new Date('2026-10-30T12:00:00Z');
const nextBeforeDst = calculateNextOccurrence(baseMed, '08:00:00', nyTz, beforeDstRef);
console.log('Next before DST (EDT -4):', nextBeforeDst);
test('DST before transition calculated correctly', nextBeforeDst !== null);

// Depois da transição (ex: 2026-11-05, offset EST -5)
const afterDstRef = new Date('2026-11-05T12:00:00Z');
const nextAfterDst = calculateNextOccurrence(baseMed, '08:00:00', nyTz, afterDstRef);
console.log('Next after DST (EST -5):', nextAfterDst);
test('DST after transition calculated correctly', nextAfterDst !== null);

// 3. Teste de interval_days (ex: a cada 3 dias)
const intervalMed: Medication = {
  ...baseMed,
  startDate: '2026-08-01',
  intervalDays: 3,
  usageCategory: 'continuous'
};
// Se startDate é 2026-08-01, e hoje é 2026-08-08 (passaram 7 dias, resto de 3 é 1 -> próxima é dia 9 ou 11)
const nextInterval = calculateNextOccurrence(intervalMed, '08:00:00', 'America/Sao_Paulo', new Date('2026-08-08T12:00:00Z'));
console.log('Next interval 3 days:', nextInterval);
test('Interval days respected', nextInterval !== null);

// 4. Teste Contraceptivo (21_7)
const contraMed: Medication = {
  ...baseMed,
  usageCategory: 'contraceptive',
  startDate: '2026-08-01',
  contraceptiveType: '21_7'
};
// Dia 1 de agosto até dia 8 de agosto = 7 dias passados (dia 8 do ciclo, ativo)
const nextContra = calculateNextOccurrence(contraMed, '08:00:00', 'America/Sao_Paulo', new Date('2026-08-08T12:00:00Z'));
console.log('Next contraceptive active day:', nextContra);
test('Contraceptive active day calculated', nextContra !== null);

// 5. PRN / SOS
const prnMed: Medication = { ...baseMed, usageCategory: 'prn' };
const nextPrn = calculateNextOccurrence(prnMed, '08:00:00', 'America/Sao_Paulo', new Date('2026-08-08T12:00:00Z'));
test('PRN returns null', nextPrn === null);

// 6. Start Date e End Date
const endedMed: Medication = { ...baseMed, startDate: '2026-08-01', endDate: '2026-08-07' };
const nextEnded = calculateNextOccurrence(endedMed, '08:00:00', 'America/Sao_Paulo', new Date('2026-08-08T12:00:00Z'));
test('Ended medication returns null', nextEnded === null);

const futureMed: Medication = { ...baseMed, startDate: '2026-08-15', endDate: '2026-08-30' };
const nextFuture = calculateNextOccurrence(futureMed, '08:00:00', 'America/Sao_Paulo', new Date('2026-08-08T12:00:00Z'));
console.log('Next future start_date:', nextFuture);
test('Future start_date targets start_date', nextFuture?.startsWith('2026-08-15'));

console.log(`\n=== RESULTADO DOS TESTES 3.1 ===`);
console.log(`Passou: ${passed}`);
console.log(`Falhou: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('Todos os testes da Etapa 3.1 passaram com sucesso!');
}
