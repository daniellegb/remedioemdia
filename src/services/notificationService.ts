
import { supabase } from '../lib/supabase';

function formatEventDateTime(dateVal: string | Date, timeVal?: string, userTz: string = 'America/Sao_Paulo'): { dateStr: string, timeStr: string } {
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal.trim())) {
    const [, month, day] = dateVal.trim().split('-');
    const dateStr = `${day}/${month}`;
    const timeStr = timeVal ? timeVal.substring(0, 5) : '00:00';
    return { dateStr, timeStr };
  }

  const d = new Date(dateVal);
  if (isNaN(d.getTime())) {
    return { dateStr: '01/01', timeStr: '00:00' };
  }

  const formatterDate = new Intl.DateTimeFormat('pt-BR', {
    timeZone: userTz,
    day: '2-digit',
    month: '2-digit'
  });
  const dateStr = formatterDate.format(d);

  const formatterTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: userTz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const timeStr = timeVal ? timeVal.substring(0, 5) : formatterTime.format(d);

  return { dateStr, timeStr };
}

export const notificationService = {
  async scheduleMedicationNotification(userId: string, medicationId: string, medicationName: string, dosage: string, triggerAt: string) {
    // Evitar duplicatas para o mesmo horário e medicamento
    const { data: existing } = await supabase
      .from('notification_queue')
      .select('id')
      .eq('medication_id', medicationId)
      .eq('trigger_at', triggerAt)
      .eq('sent', false)
      .maybeSingle();

    if (existing) return;

    const { dateStr, timeStr } = formatEventDateTime(triggerAt);
    const title = 'Remédio em Dia';
    const body = `${medicationName} — agendada para ${dateStr} às ${timeStr}.`;

    const { error } = await supabase
      .from('notification_queue')
      .insert([{
        user_id: userId,
        medication_id: medicationId,
        title,
        body,
        trigger_at: triggerAt,
        scheduled_at: triggerAt,
        sent: false,
        metadata: {
          medication_id: medicationId,
          medication_name: medicationName
        }
      }]);

    if (error) console.error('Error scheduling notification:', error);
  },

  async scheduleAppointmentNotification(
    userId: string,
    appointmentId: string,
    doctorOrSpecialty: string,
    type: string,
    triggerAt: string,
    eventDate?: string,
    eventTime?: string
  ) {
    const { dateStr, timeStr } = formatEventDateTime(
      eventDate || triggerAt,
      eventTime
    );

    const appType = type || 'Consulta';
    const detail = doctorOrSpecialty || 'Geral';
    const title = 'Remédio em Dia';
    const body = `${appType}: ${detail} — agendada para ${dateStr} às ${timeStr}.`;

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
          doctor_or_specialty: detail,
          event_date: eventDate,
          event_time: eventTime
        }
      }]);

    if (error) console.error('Error scheduling appointment notification:', error);
  }
};
