import { Medication } from '../../types';
import { calculatePeriodDoses, isContraceptivePauseDay } from './medicationRules';

export interface ScheduledMedicationDose {
  medicationId: string;
  medicationName: string;
  medication: Medication;
  time: string; // "HH:mm"
  date: string; // "YYYY-MM-DD"
  dosage?: string;
  unit?: string;
}

/**
 * Converte Date ou string para "YYYY-MM-DD" local sem distorção de fuso.
 */
export function formatDateToYYYYMMDD(date: Date | string): string {
  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converte Date ou string para uma instância de Date à meia-noite local (00:00:00.000).
 */
export function parseDateToMidnight(date: Date | string): Date {
  if (typeof date === 'string') {
    const [y, m, d] = date.split('T')[0].split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const clean = new Date(date);
  clean.setHours(0, 0, 0, 0);
  return clean;
}

/**
 * Retorna os horários agendados de um medicamento específico em uma data alvo.
 * Retorna array vazio se o medicamento não tiver doses programadas para a data.
 */
export function getMedicationScheduledTimesForDate(
  med: Medication,
  targetDate: Date | string
): string[] {
  if (!med || med.deleted || med.active === false) {
    return [];
  }

  // PRN não gera horários fixos agendados
  if (med.usageCategory === 'prn') {
    return [];
  }

  if (!med.times || med.times.length === 0) {
    return [];
  }

  const targetDateAtMidnight = parseDateToMidnight(targetDate);
  const targetDateStr = formatDateToYYYYMMDD(targetDate);

  // Verificação de data de início (startDate)
  if (med.startDate) {
    const startAtMidnight = parseDateToMidnight(med.startDate);
    if (targetDateAtMidnight < startAtMidnight) {
      return [];
    }
  }

  // Verificação de data de término (endDate) para categorias que não sejam 'period'
  // (para 'period', a duração é controlada pela contagem determinística de doses)
  if (med.usageCategory !== 'period' && med.endDate) {
    const endAtMidnight = parseDateToMidnight(med.endDate);
    if (targetDateAtMidnight > endAtMidnight) {
      return [];
    }
  }

  // 1. Anticoncepcionais (respeitando pausas de cartela 21/7, 24/4, etc.)
  if (med.usageCategory === 'contraceptive') {
    if (isContraceptivePauseDay(med, targetDateAtMidnight)) {
      return [];
    }
    return [...med.times].sort();
  }

  // 2. Medicamentos "Por período" (doses determinísticas por contagem)
  if (med.usageCategory === 'period') {
    const sortedTimes = [...med.times].sort();
    const totalDoses = (med.durationDays || 0) * sortedTimes.length;
    const periodDoses = calculatePeriodDoses(
      med.startDate || '',
      sortedTimes[0] || '',
      sortedTimes,
      totalDoses
    );

    return periodDoses
      .filter(d => d.date === targetDateStr)
      .map(d => d.time);
  }

  // 3. Uso Contínuo ou Intervalos (com suporte a intervalDays > 1)
  if (med.usageCategory === 'continuous' || med.usageCategory === 'intervals' || !med.usageCategory) {
    const interval = med.intervalDays || 1;
    if (interval > 1 && med.startDate) {
      const startAtMidnight = parseDateToMidnight(med.startDate);
      const diffTime = targetDateAtMidnight.getTime() - startAtMidnight.getTime();
      const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
      if (diffDays < 0 || diffDays % interval !== 0) {
        return [];
      }
    }

    return [...med.times].sort();
  }

  return [...med.times].sort();
}

/**
 * Determina se um medicamento possui administração agendada em uma data alvo.
 */
export function isMedicationScheduledOnDate(
  med: Medication,
  targetDate: Date | string
): boolean {
  return getMedicationScheduledTimesForDate(med, targetDate).length > 0;
}

/**
 * Função canônica para obter todas as doses agendadas de uma lista de medicamentos em uma data.
 * Orquestra as regras puras de domínio existentes sem duplicá-las.
 * 
 * @param medications Lista de medicamentos a avaliar
 * @param targetDate Data de destino (Date ou string "YYYY-MM-DD")
 * @returns Lista de doses ordenadas cronologicamente por horário
 */
export function getScheduledDosesForDate(
  medications: Medication[],
  targetDate: Date | string
): ScheduledMedicationDose[] {
  const targetDateStr = formatDateToYYYYMMDD(targetDate);
  const scheduledDoses: ScheduledMedicationDose[] = [];

  for (const med of medications) {
    const times = getMedicationScheduledTimesForDate(med, targetDate);

    for (const time of times) {
      scheduledDoses.push({
        medicationId: med.id,
        medicationName: med.name,
        medication: med,
        time,
        date: targetDateStr,
        dosage: med.dosage,
        unit: med.unit
      });
    }
  }

  // Ordenação cronológica estável por horário e depois por nome do medicamento
  return scheduledDoses.sort((a, b) => {
    const timeCompare = a.time.localeCompare(b.time);
    if (timeCompare !== 0) return timeCompare;
    return a.medicationName.localeCompare(b.medicationName);
  });
}
