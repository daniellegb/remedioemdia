
import { supabase } from '../lib/supabase';
import { convertLocalToUTC } from '../domain/nextOccurrenceCalculator';

export function calculateAppointmentTriggerAt(
  eventDate: string,
  eventTime?: string,
  userTz: string = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
): string {
  const [yearStr, monthStr, dayStr] = eventDate.trim().split('-');
  const [hourStr, minuteStr] = (eventTime ? eventTime.trim() : '09:00').split(':');

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10) || 0;
  const minute = parseInt(minuteStr, 10) || 0;

  // Subtrair exatamente 1 dia civil (24 horas antes)
  const civilDate = new Date(Date.UTC(year, month - 1, day));
  civilDate.setUTCDate(civilDate.getUTCDate() - 1);

  const prevYear = civilDate.getUTCFullYear();
  const prevMonth = civilDate.getUTCMonth() + 1;
  const prevDay = civilDate.getUTCDate();

  const utcDate = convertLocalToUTC(prevYear, prevMonth, prevDay, hour, minute, userTz);
  if (utcDate) {
    return utcDate.toISOString();
  }

  return new Date(Date.UTC(prevYear, prevMonth - 1, prevDay, hour, minute, 0)).toISOString();
}

export const notificationService = {
  async scheduleAppointmentNotification(
    userId: string,
    appointmentId: string,
    doctorOrSpecialty: string,
    type: string,
    eventDate: string,
    eventTime?: string,
    userTz: string = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  ) {
    const isExam = (type || '').trim().toLowerCase() === 'exame';
    const appType = isExam ? 'Exame' : 'Consulta';
    const title = 'Remédio em Dia';
    const body = isExam
      ? 'Você tem um exame agendado. Confira os detalhes no Painel Hoje.'
      : 'Você tem uma consulta agendada. Confira os detalhes no Painel Hoje.';

    const triggerAt = calculateAppointmentTriggerAt(eventDate, eventTime, userTz);

    const { error } = await supabase
      .from('notification_queue')
      .insert([{
        user_id: userId,
        appointment_id: appointmentId,
        title,
        body,
        trigger_at: triggerAt,
        scheduled_at: triggerAt,
        sent: false,
        metadata: {
          appointment_id: appointmentId,
          type: appType,
          doctor_or_specialty: doctorOrSpecialty || 'Geral',
          event_date: eventDate,
          event_time: eventTime,
          timezone: userTz
        }
      }]);

    if (error) console.error('Error scheduling appointment notification:', error);
  }
};

