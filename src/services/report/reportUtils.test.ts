import { buildConfiguredRemindersFromMedications } from './reportUtils';
import { Medication } from '../../../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FALHA NO TESTE: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

console.log('--- EXECUTANDO TESTES UNITÁRIOS DE REPORT UTILS (CONFIGURED REMINDERS) ---');

// 1. Array vazio ou nulo
console.log('1. Testando entrada vazia, nula ou indefinida...');
assert(buildConfiguredRemindersFromMedications(null).length === 0, 'null retorna array vazio');
assert(buildConfiguredRemindersFromMedications(undefined).length === 0, 'undefined retorna array vazio');
assert(buildConfiguredRemindersFromMedications([]).length === 0, '[] retorna array vazio');

// 2. Medicamento com um único horário
console.log('2. Testando medicamento com um único horário...');
const medUnico: Medication = {
  id: 'med-1',
  name: 'Losartana',
  dosage: '50mg',
  unit: 'comprimido',
  frequency: 1,
  totalStock: 30,
  currentStock: 30,
  color: 'blue',
  times: ['08:00'],
  active: true
};
const res1 = buildConfiguredRemindersFromMedications([medUnico]);
assert(res1.length === 1, 'Gera exatamente 1 entrada');
assert(res1[0].medicationName === 'Losartana', 'Nome correto');
assert(res1[0].time === '08:00', 'Horário correto');
assert(res1[0].active === true, 'Status ativo');

// 3. Medicamento com múltiplos horários não ordenados
console.log('3. Testando medicamento com múltiplos horários não ordenados...');
const medMultiplo: Medication = {
  id: 'med-2',
  name: 'Metformina',
  dosage: '850mg',
  unit: 'comprimido',
  frequency: 3,
  totalStock: 60,
  currentStock: 60,
  color: 'blue',
  times: ['20:00', '08:00', '14:00'], // Fora de ordem
  active: true
};
const res2 = buildConfiguredRemindersFromMedications([medMultiplo]);
assert(res2.length === 3, 'Gera 3 entradas para 3 horários');
assert(res2[0].time === '08:00', 'Primeiro horário ordenado 08:00');
assert(res2[1].time === '14:00', 'Segundo horário ordenado 14:00');
assert(res2[2].time === '20:00', 'Terceiro horário ordenado 20:00');
assert(res2.every(r => r.medicationName === 'Metformina'), 'Todas as entradas têm o nome do medicamento');

// 4. Medicamentos sem horários ou com array vazio
console.log('4. Testando medicamentos sem horários ou com valores inválidos...');
const medSemHorario: Medication = {
  id: 'med-3',
  name: 'Vitamina D',
  dosage: '1 gota',
  unit: 'gota',
  frequency: 1,
  totalStock: 10,
  currentStock: 10,
  color: 'yellow',
  times: [],
  active: true
};
const medComTimesInvalido: any = {
  id: 'med-4',
  name: 'Glicose',
  dosage: '1',
  unit: 'dose',
  frequency: 1,
  totalStock: 10,
  currentStock: 10,
  color: 'blue',
  times: ['', '   ', null, undefined],
  active: true
};
const res3 = buildConfiguredRemindersFromMedications([medSemHorario, medComTimesInvalido]);
assert(res3.length === 0, 'Medicamentos sem horários válidos não geram lembretes');

// 5. Medicamento inativo vs ativo
console.log('5. Testando medicamento inativo...');
const medInativo: Medication = {
  id: 'med-5',
  name: 'Antibiótico Finalizado',
  dosage: '500mg',
  unit: 'comprimido',
  frequency: 1,
  totalStock: 0,
  currentStock: 0,
  color: 'red',
  times: ['12:00'],
  active: false
};
const res4 = buildConfiguredRemindersFromMedications([medInativo]);
assert(res4.length === 1, 'Medicamento inativo mantém registro de configuração');
assert(res4[0].active === false, 'Status reflete inativo');

// 6. Medicamento deletado (soft delete)
console.log('6. Testando medicamento deletado (soft delete)...');
const medDeletado: Medication = {
  id: 'med-6',
  name: 'Medicamento Excluído',
  dosage: '10mg',
  unit: 'comprimido',
  frequency: 1,
  totalStock: 0,
  currentStock: 0,
  color: 'gray',
  times: ['09:00', '21:00'],
  deleted: true,
  active: false
};
const res5 = buildConfiguredRemindersFromMedications([medDeletado]);
assert(res5.length === 0, 'Medicamento deletado não gera lembretes na lista ativa');

// 7. Múltiplos medicamentos combinados
console.log('7. Testando múltiplos medicamentos combinados...');
const todosMeds = [medUnico, medMultiplo, medSemHorario, medInativo, medDeletado];
const res6 = buildConfiguredRemindersFromMedications(todosMeds);
// Esperado: 1 de Losartana + 3 de Metformina + 0 de Vitamina D + 1 de Antibiótico (inativo) + 0 de Excluído = 5 entradas
assert(res6.length === 5, 'Total de 5 lembretes configurados');
assert(res6[0].medicationName === 'Losartana' && res6[0].time === '08:00', 'Entrada 1: Losartana 08:00');
assert(res6[1].medicationName === 'Metformina' && res6[1].time === '08:00', 'Entrada 2: Metformina 08:00');
assert(res6[2].medicationName === 'Metformina' && res6[2].time === '14:00', 'Entrada 3: Metformina 14:00');
assert(res6[3].medicationName === 'Metformina' && res6[3].time === '20:00', 'Entrada 4: Metformina 20:00');
assert(res6[4].medicationName === 'Antibiótico Finalizado' && res6[4].time === '12:00' && res6[4].active === false, 'Entrada 5: Antibiótico 12:00 inativo');

console.log('✅ TODOS OS TESTES UNITÁRIOS DE REPORT UTILS PASSARAM COM SUCESSO!');
