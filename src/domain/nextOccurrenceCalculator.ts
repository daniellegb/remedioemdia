import { Medication } from '../../types';
import { isContraceptivePauseDay } from './medicationRules';

/**
 * Converte data/hora local em um determinado timezone IANA para um objeto Date absoluto (UTC).
 * Trata corretamente offsets de DST e transições de fuso horário.
 */
export function convertLocalToUTC(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date | null {
  if (!timeZone) return null;

  let testTime = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let i = 0; i < 3; i++) {
    const d = new Date(testTime);
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch (e) {
      // Timezone inválido: retornar null explicitamente para evitar fallback silencioso incorreto
      return null;
    }

    const parts = formatter.formatToParts(d);
    const pm: Record<string, string> = {};
    parts.forEach(p => pm[p.type] = p.value);

    const fYear = parseInt(pm['year'], 10);
    const fMonth = parseInt(pm['month'], 10);
    const fDay = parseInt(pm['day'], 10);
    const fHour = parseInt(pm['hour'], 10);
    const fMinute = parseInt(pm['minute'], 10);

    const targetFormatted = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const currentFormatted = `${fYear}-${String(fMonth).padStart(2, '0')}-${String(fDay).padStart(2, '0')} ${String(fHour).padStart(2, '0')}:${String(fMinute).padStart(2, '0')}`;

    if (targetFormatted === currentFormatted) {
      return d;
    }

    const dTimeFormatted = new Date(Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute, 0)).getTime();
    const dTargetFormatted = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = dTimeFormatted - dTargetFormatted;

    testTime -= diff;
  }

  return new Date(testTime);
}

/**
 * Obtém os componentes de data/hora locais (ano, mês, dia, hora, minuto) para um determinado Date e timezone IANA.
 */
export function getLocalComponents(date: Date, timeZone: string) {
  if (!timeZone) return null;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch (e) {
    return null;
  }

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  parts.forEach(p => partMap[p.type] = p.value);

  return {
    year: parseInt(partMap['year'], 10),
    month: parseInt(partMap['month'], 10),
    day: parseInt(partMap['day'], 10),
    hour: parseInt(partMap['hour'], 10),
    minute: parseInt(partMap['minute'], 10)
  };
}

/**
 * Calcula o próximo `next_occurrence_at` (em TIMESTAMPTZ / ISO String) para um lembrete,
 * respeitando o timezone do usuário, horário local, start_date, end_date e regras de recorrência.
 */
export function calculateNextOccurrence(
  med: Medication & { usage_category?: string; start_date?: string; end_date?: string; interval_days?: number },
  reminderTime: string, // e.g. "08:00:00" or "08:00"
  timeZone: string,
  referenceDate: Date = new Date()
): string | null {
  const usageCategory = med.usage_category || med.usageCategory;
  const startDate = med.start_date || med.startDate;
  const endDate = med.end_date || med.endDate;
  const intervalDays = med.interval_days || med.intervalDays || 1;

  if (usageCategory === 'prn' || !reminderTime || !timeZone) {
    return null;
  }

  // Obter componentes locais na referência
  const localNow = getLocalComponents(referenceDate, timeZone);
  if (!localNow) {
    return null; // Timezone inválido ou ausente -> retorno seguro sem fallback silencioso para UTC
  }
  const todayY = localNow.year;
  const todayM = localNow.month;
  const todayD = localNow.day;
  const todayHour = localNow.hour;
  const todayMinute = localNow.minute;

  const [remHour, remMin] = reminderTime.substring(0, 5).split(':').map(Number);

  // Verificar se a data de término já passou (comparação de data local)
  if (endDate) {
    const [endY, endM, endD] = endDate.split('-').map(Number);
    const endDateVal = endY * 10000 + endM * 100 + endD;
    const todayVal = todayY * 10000 + todayM * 100 + todayD;
    if (endDateVal < todayVal) {
      return null;
    }
  }

  // Determinar data candidata inicial
  let targetY = todayY;
  let targetM = todayM;
  let targetD = todayD;

  const totalMinutesNow = todayHour * 60 + todayMinute;
  const totalMinutesRem = remHour * 60 + remMin;

  // Se o horário de hoje já passou, avançar para amanhã (ou próximo dia de intervalo)
  let advanceDays = 0;
  if (totalMinutesRem <= totalMinutesNow) {
    advanceDays = 1;
  }

  // Se houver intervalo de dias (ex: continuous com intervalDays > 1 ou intervals)
  if (startDate) {
    const [startY, startM, startD] = startDate.split('-').map(Number);
    const startDateObj = new Date(Date.UTC(startY, startM - 1, startD));
    const candidateObj = new Date(Date.UTC(targetY, targetM - 1, targetD));
    candidateObj.setUTCDate(candidateObj.getUTCDate() + advanceDays);

    if (candidateObj < startDateObj) {
      targetY = startY;
      targetM = startM;
      targetD = startD;
      advanceDays = 0;
    } else if (intervalDays > 1 && usageCategory === 'continuous') {
      const diffTime = candidateObj.getTime() - startDateObj.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      const remainder = diffDays % intervalDays;
      if (remainder !== 0) {
        advanceDays += (intervalDays - remainder);
      }
    }
  }

  // Aplicar advanceDays na data candidata
  let candidateDate = new Date(Date.UTC(targetY, targetM - 1, targetD));
  candidateDate.setUTCDate(candidateDate.getUTCDate() + advanceDays);
  targetY = candidateDate.getUTCFullYear();
  targetM = candidateDate.getUTCMonth() + 1;
  targetD = candidateDate.getUTCDate();

  // Tratamento de Anticoncepcional com Pausa
  if (usageCategory === 'contraceptive') {
    let checkDate = new Date(Date.UTC(todayY, todayM - 1, todayD));
    // Verificar se hoje ainda serve (se horário não passou e não é pausa)
    const isTodayActive = totalMinutesRem > totalMinutesNow && !isContraceptivePauseDay(med, referenceDate);
    if (!isTodayActive) {
      checkDate.setUTCDate(checkDate.getUTCDate() + 1);
    }

    for (let i = 0; i < 60; i++) {
      const cY = checkDate.getUTCFullYear();
      const cM = checkDate.getUTCMonth() + 1;
      const cD = checkDate.getUTCDate();
      const cDateObj = new Date(`${cY}-${String(cM).padStart(2, '0')}-${String(cD).padStart(2, '0')}T12:00:00Z`);

      if (!isContraceptivePauseDay(med, cDateObj)) {
        // Verificar start_date
        let valid = true;
        if (startDate) {
          const [sY, sM, sD] = startDate.split('-').map(Number);
          const sDateVal = sY * 10000 + sM * 100 + sD;
          const cDateVal = cY * 10000 + cM * 100 + cD;
          if (cDateVal < sDateVal) valid = false;
        }
        if (endDate) {
          const [eY, eM, eD] = endDate.split('-').map(Number);
          const eDateVal = eY * 10000 + eM * 100 + eD;
          const cDateVal = cY * 10000 + cM * 100 + cD;
          if (cDateVal > eDateVal) valid = false;
        }

        if (valid) {
          targetY = cY;
          targetM = cM;
          targetD = cD;
          break;
        }
      }
      checkDate.setUTCDate(checkDate.getUTCDate() + 1);
    }
  }

  // Validação final de end_date
  if (endDate) {
    const [eY, eM, eD] = endDate.split('-').map(Number);
    const endVal = eY * 10000 + eM * 100 + eD;
    const targetVal = targetY * 10000 + targetM * 100 + targetD;
    if (targetVal > endVal) {
      return null;
    }
  }

  // Converter data/hora local para timestamp absoluto UTC considerando o IANA timezone
  const utcDate = convertLocalToUTC(targetY, targetM, targetD, remHour, remMin, timeZone);
  return utcDate ? utcDate.toISOString() : null;
}
