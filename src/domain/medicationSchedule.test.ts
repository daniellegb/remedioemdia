import { Medication } from '../../types';
import {
  getScheduledDosesForDate,
  getMedicationScheduledTimesForDate,
  isMedicationScheduledOnDate,
  formatDateToYYYYMMDD,
  parseDateToMidnight
} from './medicationSchedule';
import { isContraceptivePauseDay } from './medicationRules';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('--- EXECUTANDO TESTES UNITÁRIOS DE MEDICATION SCHEDULE ---');

// 1. Testes de utilitários de data
console.log('1. Testando formatação e parsing de datas...');
assert(formatDateToYYYYMMDD('2026-08-23T10:00:00') === '2026-08-23', 'formatDateToYYYYMMDD com ISO string');
assert(formatDateToYYYYMMDD('2026-08-23') === '2026-08-23', 'formatDateToYYYYMMDD com string YYYY-MM-DD');
const sampleDate = new Date(2026, 7, 23, 15, 30); // Agosto = mês 7 (0-indexed)
assert(formatDateToYYYYMMDD(sampleDate) === '2026-08-23', 'formatDateToYYYYMMDD com objeto Date');

// 2. Uso contínuo diário (intervalDays = 1) com múltiplos horários
console.log('2. Testando uso contínuo diário...');
const medContinuo: Medication = {
  id: 'med-1',
  name: 'Losartana',
  dosage: '50mg',
  unit: 'comprimido',
  frequency: 2,
  usageCategory: 'continuous',
  times: ['20:00', '08:00'], // não ordenado de propósito
  startDate: '2026-08-01',
  totalStock: 30,
  currentStock: 30,
  color: 'blue',
  active: true,
  deleted: false
};

const dosesHoje = getScheduledDosesForDate([medContinuo], '2026-08-23');
assert(dosesHoje.length === 2, 'Deve ter 2 doses');
assert(dosesHoje[0].time === '08:00', 'Primeira dose ordenada deve ser 08:00');
assert(dosesHoje[1].time === '20:00', 'Segunda dose ordenada deve ser 20:00');
assert(dosesHoje[0].medicationName === 'Losartana', 'Nome do medicamento correto');
assert(isMedicationScheduledOnDate(medContinuo, '2026-08-23'), 'Deve estar agendado hoje');

// 3. Uso com intervalo de dias (ex: a cada 2 dias)
console.log('3. Testando intervalos de dias (ex: a cada 2 dias)...');
const medIntervalo: Medication = {
  id: 'med-2',
  name: 'Vitamina D',
  dosage: '1 dose',
  unit: 'dose',
  frequency: 1,
  usageCategory: 'continuous',
  intervalDays: 2,
  times: ['09:00'],
  startDate: '2026-08-20', // Dias ativos: 20, 22, 24, 26...
  totalStock: 10,
  currentStock: 10,
  color: 'yellow',
  active: true
};

assert(isMedicationScheduledOnDate(medIntervalo, '2026-08-20'), 'Dia 20 (início) deve ter dose');
assert(!isMedicationScheduledOnDate(medIntervalo, '2026-08-21'), 'Dia 21 NÃO deve ter dose');
assert(isMedicationScheduledOnDate(medIntervalo, '2026-08-22'), 'Dia 22 deve ter dose');
assert(!isMedicationScheduledOnDate(medIntervalo, '2026-08-23'), 'Dia 23 NÃO deve ter dose');
assert(isMedicationScheduledOnDate(medIntervalo, '2026-08-24'), 'Dia 24 deve ter dose');

// 4. Medicamentos "Por período" (contagem determinística)
console.log('4. Testando medicamentos por período...');
const medPeriodo: Medication = {
  id: 'med-3',
  name: 'Amoxicilina',
  dosage: '500mg',
  unit: 'comprimido',
  frequency: 2,
  usageCategory: 'period',
  durationDays: 3,
  times: ['08:00', '20:00'],
  startDate: '2026-08-20', // Total 6 doses: 20 (08:00, 20:00), 21 (08:00, 20:00), 22 (08:00, 20:00)
  totalStock: 6,
  currentStock: 6,
  color: 'red',
  active: true
};

assert(isMedicationScheduledOnDate(medPeriodo, '2026-08-20'), 'Dia 1 do período deve ter dose');
assert(isMedicationScheduledOnDate(medPeriodo, '2026-08-21'), 'Dia 2 do período deve ter dose');
assert(isMedicationScheduledOnDate(medPeriodo, '2026-08-22'), 'Dia 3 do período deve ter dose');
assert(!isMedicationScheduledOnDate(medPeriodo, '2026-08-23'), 'Dia 4 (após o fim) NÃO deve ter dose');

const dosesPeriodoDia20 = getMedicationScheduledTimesForDate(medPeriodo, '2026-08-20');
assert(dosesPeriodoDia20.length === 2 && dosesPeriodoDia20[0] === '08:00' && dosesPeriodoDia20[1] === '20:00', 'Horários do dia 20');

// 5. Anticoncepcionais (21/7 e 24/4 com pausas)
console.log('5. Testando anticoncepcionais e pausas...');
const medAnticoncepcional21_7: Medication = {
  id: 'med-4',
  name: 'Pílula 21/7',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  usageCategory: 'contraceptive',
  contraceptiveType: '21_7',
  times: ['21:00'],
  startDate: '2026-08-01', // Dias 1 a 21 ativos (01 a 21 de agosto). Dias 22 a 28 pausa (22 a 28 de agosto).
  totalStock: 21,
  currentStock: 21,
  color: 'pink',
  active: true
};

assert(isMedicationScheduledOnDate(medAnticoncepcional21_7, '2026-08-21'), 'Dia 21 de agosto é ativo (dia 21 do ciclo)');
assert(!isMedicationScheduledOnDate(medAnticoncepcional21_7, '2026-08-22'), 'Dia 22 de agosto é PAUSA (dia 22 do ciclo)');
assert(!isMedicationScheduledOnDate(medAnticoncepcional21_7, '2026-08-28'), 'Dia 28 de agosto é PAUSA (dia 28 do ciclo)');
assert(isMedicationScheduledOnDate(medAnticoncepcional21_7, '2026-08-29'), 'Dia 29 de agosto é NOVA CARTELA (dia 1 do ciclo)');

// 6. PRN (Se necessário)
console.log('6. Testando medicamentos PRN...');
const medPRN: Medication = {
  id: 'med-5',
  name: 'Dipirona SOS',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  usageCategory: 'prn',
  maxDosesPerDay: 4,
  times: [],
  totalStock: 20,
  currentStock: 20,
  color: 'purple',
  active: true
};

assert(!isMedicationScheduledOnDate(medPRN, '2026-08-23'), 'PRN não gera doses agendadas');
assert(getScheduledDosesForDate([medPRN], '2026-08-23').length === 0, 'Lista de doses para PRN deve ser vazia');

// 7. Medicamentos inativos e deletados
console.log('7. Testando medicamentos inativos e deletados...');
const medInativo: Medication = {
  ...medContinuo,
  id: 'med-6',
  active: false
};
const medDeletado: Medication = {
  ...medContinuo,
  id: 'med-7',
  deleted: true
};

assert(!isMedicationScheduledOnDate(medInativo, '2026-08-23'), 'Inativo não gera doses agendadas');
assert(!isMedicationScheduledOnDate(medDeletado, '2026-08-23'), 'Deletado não gera doses agendadas');

// 8. StartDate futura e EndDate passada
console.log('8. Testando startDate futura e endDate passada...');
const medFuturo: Medication = {
  ...medContinuo,
  id: 'med-8',
  startDate: '2026-09-01'
};
const medPassado: Medication = {
  ...medContinuo,
  id: 'med-9',
  startDate: '2026-08-01',
  endDate: '2026-08-15'
};

assert(!isMedicationScheduledOnDate(medFuturo, '2026-08-23'), 'Data antes do startDate não deve ter dose');
assert(!isMedicationScheduledOnDate(medPassado, '2026-08-23'), 'Data após o endDate não deve ter dose');

// 9. Agendamento com múltiplos medicamentos e ordenação
console.log('9. Testando lista com múltiplos medicamentos e ordenação...');
const todasDoses = getScheduledDosesForDate([medContinuo, medIntervalo, medPeriodo], '2026-08-20');
// No dia 20:
// medContinuo: 08:00, 20:00
// medIntervalo: 09:00
// medPeriodo: 08:00, 20:00
// Total = 5 doses
assert(todasDoses.length === 5, 'Deve ter 5 doses no total no dia 20');
assert(todasDoses[0].time === '08:00', 'Primeira dose às 08:00');
assert(todasDoses[1].time === '08:00', 'Segunda dose às 08:00');
assert(todasDoses[2].time === '09:00', 'Terceira dose às 09:00');
assert(todasDoses[3].time === '20:00', 'Quarta dose às 20:00');
assert(todasDoses[4].time === '20:00', 'Quinta dose às 20:00');

// 10. Testes de borda: startDate e endDate exatos, limites e transição de mês/ano
console.log('10. Testando casos de borda de startDate, endDate, mudança de mês e ano...');
const medBordas: Medication = {
  id: 'med-10',
  name: 'Anti-hipertensivo',
  dosage: '1 comp',
  unit: 'comprimido',
  frequency: 1,
  totalStock: 30,
  currentStock: 30,
  color: 'blue',
  usageCategory: 'continuous',
  times: ['08:00'],
  startDate: '2026-12-30',
  endDate: '2027-01-02',
  active: true
};

assert(!isMedicationScheduledOnDate(medBordas, '2026-12-29'), 'Dia anterior ao startDate não tem dose');
assert(isMedicationScheduledOnDate(medBordas, '2026-12-30'), 'No dia exato do startDate TEM dose');
assert(isMedicationScheduledOnDate(medBordas, '2026-12-31'), 'No último dia do ano TEM dose');
assert(isMedicationScheduledOnDate(medBordas, '2027-01-01'), 'Na virada do ano TEM dose');
assert(isMedicationScheduledOnDate(medBordas, '2027-01-02'), 'No dia exato do endDate TEM dose');
assert(!isMedicationScheduledOnDate(medBordas, '2027-01-03'), 'Dia seguinte ao endDate NÃO tem dose');

// 11. Testando intervalo maior (ex: intervalDays = 3)
console.log('11. Testando intervalDays = 3...');
const medIntervalo3: Medication = {
  id: 'med-11',
  name: 'Injeção Trissemanal',
  dosage: '1 ampola',
  unit: 'dose',
  frequency: 1,
  totalStock: 10,
  currentStock: 10,
  color: 'blue',
  usageCategory: 'intervals',
  intervalDays: 3,
  times: ['14:00'],
  startDate: '2026-08-01', // Dias: 01, 04, 07, 10, 13, 16, 19, 22, 25...
  active: true
};

assert(isMedicationScheduledOnDate(medIntervalo3, '2026-08-01'), 'Dia 01 tem dose (início)');
assert(!isMedicationScheduledOnDate(medIntervalo3, '2026-08-02'), 'Dia 02 não tem dose');
assert(!isMedicationScheduledOnDate(medIntervalo3, '2026-08-03'), 'Dia 03 não tem dose');
assert(isMedicationScheduledOnDate(medIntervalo3, '2026-08-04'), 'Dia 04 tem dose (+3 dias)');
assert(isMedicationScheduledOnDate(medIntervalo3, '2026-08-22'), 'Dia 22 tem dose (+21 dias)');
assert(!isMedicationScheduledOnDate(medIntervalo3, '2026-08-23'), 'Dia 23 não tem dose');
assert(isMedicationScheduledOnDate(medIntervalo3, '2026-08-25'), 'Dia 25 tem dose (+24 dias)');

// 12. Testando anticoncepcional 24/4 (24 ativos, 4 pausa)
console.log('12. Testando anticoncepcional 24/4...');
const medAnticoncepcional24_4: Medication = {
  id: 'med-12',
  name: 'Pílula 24/4',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  totalStock: 28,
  currentStock: 28,
  color: 'pink',
  usageCategory: 'contraceptive',
  contraceptiveType: '24_4',
  times: ['22:00'],
  startDate: '2026-08-01', // Dias 1 a 24 ativos (01 a 24/ago). Dias 25 a 28 pausa (25 a 28/ago). Dia 29 novo ciclo.
  active: true
};

assert(isMedicationScheduledOnDate(medAnticoncepcional24_4, '2026-08-24'), 'Dia 24 de agosto é último dia ativo');
assert(!isMedicationScheduledOnDate(medAnticoncepcional24_4, '2026-08-25'), 'Dia 25 de agosto é PAUSA (dia 25 do ciclo)');
assert(!isMedicationScheduledOnDate(medAnticoncepcional24_4, '2026-08-28'), 'Dia 28 de agosto é PAUSA (dia 28 do ciclo)');
assert(isMedicationScheduledOnDate(medAnticoncepcional24_4, '2026-08-29'), 'Dia 29 de agosto é NOVA CARTELA (dia 1 do ciclo)');

// 13. Medicamento sem usageCategory explícito (fallback para contínuo)
console.log('13. Testando medicamento sem usageCategory (legado/fallback)...');
const medSemCategoria: Medication = {
  id: 'med-13',
  name: 'Suplemento Sem Categoria',
  dosage: '1 comp',
  unit: 'comprimido',
  frequency: 2,
  totalStock: 60,
  currentStock: 60,
  color: 'gray',
  times: ['07:00', '19:00'],
  active: true
};

const dosesSemCategoria = getScheduledDosesForDate([medSemCategoria], '2026-08-23');
assert(dosesSemCategoria.length === 2, 'Deve tratar como contínuo diário e retornar 2 doses');
assert(dosesSemCategoria[0].time === '07:00' && dosesSemCategoria[1].time === '19:00', 'Horários corretos');

// 14. Medicamento sem horários cadastrados
console.log('14. Testando medicamento sem array times ou array vazio...');
const medSemHorario: Medication = {
  id: 'med-14',
  name: 'Sem Horário',
  dosage: '1 comp',
  unit: 'comprimido',
  frequency: 1,
  totalStock: 10,
  currentStock: 10,
  color: 'gray',
  times: [],
  active: true
};
assert(getScheduledDosesForDate([medSemHorario], '2026-08-23').length === 0, 'Sem horários não gera dose');

// 15. Formatos de entrada: objeto Date perto da meia-noite (23:59 e 00:01)
console.log('15. Testando objeto Date com horas extremas (23:59 e 00:01)...');
const dateFimDoDia = new Date(2026, 7, 23, 23, 59, 59);
const dateInicioDoDia = new Date(2026, 7, 23, 0, 1, 0);
assert(formatDateToYYYYMMDD(dateFimDoDia) === '2026-08-23', 'Date 23:59 deve resolver para 2026-08-23');
assert(formatDateToYYYYMMDD(dateInicioDoDia) === '2026-08-23', 'Date 00:01 deve resolver para 2026-08-23');
assert(getScheduledDosesForDate([medContinuo], dateFimDoDia).length === 2, 'Agenda funciona com Date às 23:59');
assert(getScheduledDosesForDate([medContinuo], dateInicioDoDia).length === 2, 'Agenda funciona com Date às 00:01');

// 16. Testes específicos de regressão e fuso horário de anticoncepcionais
console.log('16. Testando regressão e cálculo calendárico de anticoncepcionais (21/7, 24/4, fuso e virada de ano)...');
const medAnti217: Medication = {
  id: 'med-anti-217',
  name: 'Anticoncepcional 21+7 Teste',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  usageCategory: 'contraceptive',
  contraceptiveType: '21_7',
  times: ['08:00'],
  startDate: '2026-09-01',
  totalStock: 63,
  currentStock: 63,
  color: 'pink',
  active: true
};

assert(isMedicationScheduledOnDate(medAnti217, '2026-09-01'), '01/09: Dia 1 ativo');
assert(isMedicationScheduledOnDate(medAnti217, '2026-09-21'), '21/09: Dia 21 ativo');
assert(!isMedicationScheduledOnDate(medAnti217, '2026-09-22'), '22/09: Dia 22 PAUSA (1º dia de pausa)');
assert(!isMedicationScheduledOnDate(medAnti217, '2026-09-28'), '28/09: Dia 28 PAUSA (7º dia de pausa)');
assert(isMedicationScheduledOnDate(medAnti217, '2026-09-29'), '29/09: Dia 29 NOVO CICLO (Dia 1)');
assert(isMedicationScheduledOnDate(medAnti217, '2026-09-30'), '30/09: Dia 30 do ciclo 2');

// Múltiplos ciclos (Ciclo 2: 29/09 a 26/10)
assert(isMedicationScheduledOnDate(medAnti217, '2026-10-19'), '19/10: Ciclo 2, Dia 21 ativo');
assert(!isMedicationScheduledOnDate(medAnti217, '2026-10-20'), '20/10: Ciclo 2, Dia 22 PAUSA');

// Teste 24+4
const medAnti244: Medication = {
  id: 'med-anti-244',
  name: 'Anticoncepcional 24+4 Teste',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  usageCategory: 'contraceptive',
  contraceptiveType: '24_4',
  times: ['08:00'],
  startDate: '2026-09-01',
  totalStock: 56,
  currentStock: 56,
  color: 'pink',
  active: true
};

assert(isMedicationScheduledOnDate(medAnti244, '2026-09-01'), '24+4 - 01/09: Dia 1 ativo');
assert(isMedicationScheduledOnDate(medAnti244, '2026-09-24'), '24+4 - 24/09: Dia 24 ativo');
assert(!isMedicationScheduledOnDate(medAnti244, '2026-09-25'), '24+4 - 25/09: Dia 25 PAUSA (1º dia de pausa)');
assert(!isMedicationScheduledOnDate(medAnti244, '2026-09-28'), '24+4 - 28/09: Dia 28 PAUSA (4º dia de pausa)');
assert(isMedicationScheduledOnDate(medAnti244, '2026-09-29'), '24+4 - 29/09: Dia 29 NOVO CICLO (Dia 1)');

// Antes do início
assert(!isContraceptivePauseDay(medAnti217, new Date(2026, 7, 31)), '31/08: Antes do início não é dia de pausa');

// Virada de Ano (Início 15/12/2026)
const medAntiAno: Medication = {
  id: 'med-anti-ano',
  name: 'Anticoncepcional Virada de Ano',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  usageCategory: 'contraceptive',
  contraceptiveType: '21_7',
  times: ['08:00'],
  startDate: '2026-12-15',
  totalStock: 63,
  currentStock: 63,
  color: 'pink',
  active: true
};

assert(isMedicationScheduledOnDate(medAntiAno, '2027-01-04'), '04/01/2027: Dia 21 ativo');
assert(!isMedicationScheduledOnDate(medAntiAno, '2027-01-05'), '05/01/2027: Dia 22 PAUSA');
assert(!isMedicationScheduledOnDate(medAntiAno, '2027-01-11'), '11/01/2027: Dia 28 PAUSA');
assert(isMedicationScheduledOnDate(medAntiAno, '2027-01-12'), '12/01/2027: Dia 29 NOVO CICLO');

// Teste de imunidade a fuso horário em America/Sao_Paulo
const savedTZ = process.env.TZ;
process.env.TZ = 'America/Sao_Paulo';
const dateLocalPause22 = new Date(2026, 8, 22);
assert(!isMedicationScheduledOnDate(medAnti217, dateLocalPause22), 'America/Sao_Paulo: Dia 22/09 deve ser PAUSA');
process.env.TZ = savedTZ;

// 17. Teste de Longo Prazo: Validação de 65 ciclos contínuos (5 anos / 1.820 dias)
console.log('17. Testando uso de longo prazo por 5 anos (65 ciclos completos / 1.820 dias consecutivos)...');
const medLongoPrazo217: Medication = {
  id: 'med-longo-217',
  name: 'Anticoncepcional 5 Anos 21+7',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  usageCategory: 'contraceptive',
  contraceptiveType: '21_7',
  times: ['08:00'],
  startDate: '2026-01-01',
  totalStock: 1000,
  currentStock: 1000,
  color: 'pink',
  active: true
};

const medLongoPrazo244: Medication = {
  id: 'med-longo-244',
  name: 'Anticoncepcional 5 Anos 24+4',
  dosage: '1 comprimido',
  unit: 'comprimido',
  frequency: 1,
  usageCategory: 'contraceptive',
  contraceptiveType: '24_4',
  times: ['08:00'],
  startDate: '2026-01-01',
  totalStock: 1000,
  currentStock: 1000,
  color: 'pink',
  active: true
};

// Iterar dia a dia por 1.820 dias (65 ciclos de 28 dias)
const startBaseUtc = Date.UTC(2026, 0, 1);
for (let dayOffset = 0; dayOffset < 1820; dayOffset++) {
  const currentUtc = new Date(startBaseUtc + dayOffset * 86400000);
  const yyyy = currentUtc.getUTCFullYear();
  const mm = String(currentUtc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(currentUtc.getUTCDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const dayInCycle = (dayOffset % 28) + 1; // 1 a 28

  // Validação 21+7
  const is217Scheduled = isMedicationScheduledOnDate(medLongoPrazo217, dateStr);
  const expected217 = dayInCycle <= 21;
  assert(
    is217Scheduled === expected217,
    `Falha no dia ${dateStr} (Dia ${dayInCycle} do ciclo): Esperado ${expected217 ? 'DOSE' : 'PAUSA'}, obtido ${is217Scheduled ? 'DOSE' : 'PAUSA'}`
  );

  // Validação 24+4
  const is244Scheduled = isMedicationScheduledOnDate(medLongoPrazo244, dateStr);
  const expected244 = dayInCycle <= 24;
  assert(
    is244Scheduled === expected244,
    `Falha 24+4 no dia ${dateStr} (Dia ${dayInCycle} do ciclo): Esperado ${expected244 ? 'DOSE' : 'PAUSA'}, obtido ${is244Scheduled ? 'DOSE' : 'PAUSA'}`
  );
}

console.log('✅ Validação de 5 anos (65 ciclos / 1.820 dias) concluída com 100% de precisão!');

console.log('✅ TODOS OS TESTES UNITÁRIOS DE MEDICATION SCHEDULE PASSARAM COM SUCESSO!');
