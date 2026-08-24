import { Medication } from '../types.ts';

/**
 * Converte e normaliza o valor de dosagem para um número válido.
 * Aceita números e strings como "0.5", "0,5", "1.5", etc.
 * Retorna 1 como padrão seguro caso o valor não seja numérico ou seja <= 0.
 */
export const parseDosageAmount = (dosage?: string | number | null): number => {
  if (dosage === undefined || dosage === null) return 1;
  if (typeof dosage === 'number') {
    return isNaN(dosage) || dosage <= 0 ? 1 : dosage;
  }
  const normalized = String(dosage).trim().replace(',', '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) || parsed <= 0 ? 1 : parsed;
};

/**
 * Calcula a média de doses tomadas por dia com base na categoria e horários.
 */
export const calculateDosesPerDay = (med: Medication): number => {
  const timesCount = med.times?.length || 1;
  const interval = med.intervalDays || 1;

  switch (med.usageCategory) {
    case 'continuous':
    case 'period':
      return timesCount / interval;
    case 'intervals':
      return 1 / interval;
    case 'contraceptive':
      return 1;
    case 'prn':
      return 0; // Uso eventual não tem média fixa
    default:
      return 1;
  }
};

/**
 * Calcula o consumo diário em unidades de estoque considerando a dosagem fracionada ou múltipla.
 */
export const calculateDailyUnitsConsumed = (med: Medication): number => {
  const dosesPerDay = calculateDosesPerDay(med);
  const dosageAmount = parseDosageAmount(med.dosage);
  return dosesPerDay * dosageAmount;
};

/**
 * Calcula quantos dias o estoque atual deve durar considerando a dosagem por tomada.
 */
export const calculateDaysOfStockLeft = (med: Medication): number | null => {
  if (med.currentStock <= 0) return 0;
  const dosageAmount = parseDosageAmount(med.dosage);

  if (med.usageCategory === 'prn') {
    return Math.floor(med.currentStock / dosageAmount);
  }

  const dailyUnits = calculateDailyUnitsConsumed(med);
  if (dailyUnits <= 0) return null;

  return Math.floor(med.currentStock / dailyUnits);
};

/**
 * Projeta o estoque em uma data futura considerando a dosagem por tomada.
 */
export const projectStockOnDate = (med: Medication, targetDate: Date, today: Date): number => {
  const dailyUnits = calculateDailyUnitsConsumed(med);
  const daysFromToday = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
  
  if (daysFromToday <= 0) return med.currentStock;
  
  const projectedUnitsConsumed = daysFromToday * dailyUnits;
  const remaining = med.currentStock - projectedUnitsConsumed;
  return Math.max(0, Math.round(remaining * 10000) / 10000);
};

/**
 * Verifica se o estoque estará esgotado em uma data específica.
 */
export const isOutOfStockOnDate = (med: Medication, targetDate: Date, today: Date): boolean => {
  const projectedStock = projectStockOnDate(med, targetDate, today);
  return projectedStock <= 0;
};

/**
 * Calcula o novo valor de estoque após uma alteração de status de dose,
 * descontando ou estornando o valor exato da dosagem (incluindo decimais).
 */
export const getUpdatedStock = (
  currentStock: number, 
  newStatus: 'taken' | 'pending', 
  dosageAmount: number = 1
): number => {
  const validDoseAmount = isNaN(dosageAmount) || dosageAmount <= 0 ? 1 : dosageAmount;
  const delta = newStatus === 'taken' ? -validDoseAmount : validDoseAmount;
  const updated = (currentStock || 0) + delta;
  return Math.max(0, Math.round(updated * 10000) / 10000);
};
