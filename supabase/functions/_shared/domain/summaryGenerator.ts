import { Medication, Appointment, UserPreferences } from '../types.ts';
import { 
  getScheduledDosesForDate, 
  ScheduledMedicationDose, 
  formatDateToYYYYMMDD, 
  parseDateToMidnight 
} from './medicationSchedule.ts';
import { 
  isMedicationExpired, 
  isMedicationExpiringSoon, 
  isStockRunningOut 
} from './medicationRules.ts';
import { calculateDaysOfStockLeft } from './stock.ts';

export type SummaryCycle = 'morning' | 'afternoon' | 'night';

export interface SummaryGeneratorInput {
  userId: string;
  userTimezone?: string;
  cycle: SummaryCycle;
  localDate: string; // "YYYY-MM-DD"
  medications: Medication[];
  appointments?: Appointment[];
  preferences?: Partial<UserPreferences> | null;
}

export interface GeneratedSummary {
  shouldNotify: boolean;
  title: string;
  body: string;
  occurrenceKey: string;
  metadata: {
    type: 'daily_summary';
    cycle: SummaryCycle;
    local_date: string;
    items_count: number;
    url: string;
  };
}

/**
 * Função pura e determinística responsável por gerar o resumo de notificações para um usuário em determinado ciclo.
 * 
 * Regras:
 * - MORNING (08:00–12:59): Doses da manhã + Alertas de Estoque/Validade + Compromissos de amanhã.
 * - AFTERNOON (13:00–18:59): Doses da tarde.
 * - NIGHT (19:00–23:59 + 00:00–07:59 do dia seguinte): Doses da noite e início da manhã seguinte.
 * - Regra de Silêncio: Retorna shouldNotify: false e body vazio se não houver itens relevantes.
 */
export function generateDailySummary(input: SummaryGeneratorInput): GeneratedSummary {
  const { userId, cycle, localDate, medications = [], appointments = [], preferences } = input;
  
  const occurrenceKey = `summary:${cycle}:${userId}:${localDate}`;
  const url = '/dashboard';
  const title = 'Remédio em Dia';

  const todayMidnight = parseDateToMidnight(localDate);
  const nextDayDate = new Date(todayMidnight);
  nextDayDate.setDate(nextDayDate.getDate() + 1);
  const nextDateStr = formatDateToYYYYMMDD(nextDayDate);

  // 1. Filtragem das Doses Canônicas via medicationSchedule.ts
  const todayDoses = getScheduledDosesForDate(medications, localDate);
  let relevantDoses: ScheduledMedicationDose[] = [];

  if (cycle === 'morning') {
    relevantDoses = todayDoses.filter(d => d.time >= '08:00' && d.time < '13:00');
  } else if (cycle === 'afternoon') {
    relevantDoses = todayDoses.filter(d => d.time >= '13:00' && d.time < '19:00');
  } else if (cycle === 'night') {
    const nightDosesToday = todayDoses.filter(d => d.time >= '19:00' && d.time <= '23:59');
    const earlyMorningDosesNextDay = getScheduledDosesForDate(medications, nextDateStr).filter(
      d => d.time >= '00:00' && d.time < '08:00'
    );
    relevantDoses = [...nightDosesToday, ...earlyMorningDosesNextDay];
  }

  // 2. Alertas de Estoque e Validade (exclusivos do ciclo MORNING)
  let outOfStockCount = 0;
  let runningOutCount = 0;
  let expiredCount = 0;
  let expiringSoonCount = 0;

  if (cycle === 'morning') {
    const thresholdRunningOut = preferences?.threshold_running_out ?? 3;
    const thresholdExpiring = preferences?.threshold_expiring ?? 3;

    const activeMeds = medications.filter(m => m && !m.deleted && m.active !== false);

    for (const med of activeMeds) {
      // Estoque
      if (med.currentStock <= 0) {
        outOfStockCount++;
      } else {
        const daysLeft = calculateDaysOfStockLeft(med);
        if (isStockRunningOut(daysLeft, thresholdRunningOut)) {
          runningOutCount++;
        }
      }

      // Validade
      if (med.expiryDate) {
        if (isMedicationExpired(med.expiryDate, todayMidnight)) {
          expiredCount++;
        } else if (isMedicationExpiringSoon(med.expiryDate, todayMidnight, thresholdExpiring)) {
          expiringSoonCount++;
        }
      }
    }
  }

  // 3. Compromissos (Consultas/Exames relevantes para amanhã, exclusivos do ciclo MORNING)
  let tomorrowAppointmentsCount = 0;

  if (cycle === 'morning') {
    const activeAppointments = appointments.filter(a => a && !a.deleted && a.active !== false);
    tomorrowAppointmentsCount = activeAppointments.filter(a => a.date === nextDateStr).length;
  }

  // 4. Contagem total de itens relevantes
  const itemsCount = relevantDoses.length + outOfStockCount + runningOutCount + expiredCount + expiringSoonCount + tomorrowAppointmentsCount;

  // 5. Aplicação estrita da REGRA DE SILÊNCIO
  if (itemsCount === 0) {
    return {
      shouldNotify: false,
      title,
      body: '',
      occurrenceKey,
      metadata: {
        type: 'daily_summary',
        cycle,
        local_date: localDate,
        items_count: 0,
        url
      }
    };
  }

  // 6. Construção do Texto Consolidado
  const messages: string[] = [];

  // Doses do turno
  if (relevantDoses.length > 0) {
    const count = relevantDoses.length;
    let periodText = 'esta manhã';
    if (cycle === 'afternoon') periodText = 'esta tarde';
    if (cycle === 'night') periodText = 'esta noite e início da manhã';

    const doseWord = count === 1 ? 'administração programada' : 'administrações programadas';
    messages.push(`Você tem ${count} ${doseWord} para ${periodText}.`);
  }

  // Alertas de estoque
  if (outOfStockCount > 0) {
    const medWord = outOfStockCount === 1 ? 'remédio sem estoque' : 'remédios sem estoque';
    messages.push(`Há ${outOfStockCount} ${medWord}.`);
  }

  if (runningOutCount > 0) {
    const medWord = runningOutCount === 1 ? 'remédio próximo de acabar' : 'remédios próximos de acabar';
    messages.push(`Há ${runningOutCount} ${medWord}.`);
  }

  // Alertas de validade
  if (expiredCount > 0) {
    const medWord = expiredCount === 1 ? 'remédio vencido' : 'remédios vencidos';
    messages.push(`Há ${expiredCount} ${medWord}.`);
  }

  if (expiringSoonCount > 0) {
    const medWord = expiringSoonCount === 1 ? 'remédio próximo da data de validade' : 'remédios próximos da data de validade';
    messages.push(`Há ${expiringSoonCount} ${medWord}.`);
  }

  // Compromissos
  if (tomorrowAppointmentsCount > 0) {
    const appWord = tomorrowAppointmentsCount === 1 ? 'compromisso agendado' : 'compromissos agendados';
    messages.push(`Você tem ${tomorrowAppointmentsCount} ${appWord} para amanhã.`);
  }

  const body = messages.join(' ');

  return {
    shouldNotify: true,
    title,
    body,
    occurrenceKey,
    metadata: {
      type: 'daily_summary',
      cycle,
      local_date: localDate,
      items_count: itemsCount,
      url
    }
  };
}
