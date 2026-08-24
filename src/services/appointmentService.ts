import { supabase } from '../lib/supabase';
import { Appointment } from '../../types';
import { notificationService } from './notificationService';
import { validateTimeFormat, validateStringLength } from '../domain/validation';

export const mapAppToCamelCase = (app: any): Appointment => ({
  id: app.id,
  type: app.type,
  doctor: app.doctor,
  specialty: app.specialty,
  date: app.date,
  time: app.time,
  location: app.location,
  notes: app.notes,
  active: app.active !== false && app.active !== 'false' && app.active !== 0,
  deleted: app.deleted === true,
  keep_history: app.keep_history !== false,
  deleted_at: app.deleted_at
});

const nullIfEmpty = (val: string | undefined | null) => {
  if (val === undefined || val === null || val.trim() === '') return null;
  return val;
};

export const appointmentService = {
  async getAppointments(userId: string) {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('time', { ascending: true });

    if (error) throw error;
    return (data || []).map(mapAppToCamelCase);
  },

  async createAppointment(userId: string, data: Omit<Appointment, 'id'>) {
    const validTime = validateTimeFormat(data.time, 'Horário do compromisso');
    const validType = validateStringLength(data.type, 'Tipo de compromisso', 50, true)!;
    const validDoctor = validateStringLength(data.doctor, 'Médico', 100, false) || '';
    const validSpecialty = validateStringLength(data.specialty, 'Especialidade', 100, false) || '';
    const validLocation = validateStringLength(data.location, 'Local', 200, false) || '';
    const validNotes = validateStringLength(data.notes, 'Observações', 500, false);

    const { data: created, error } = await supabase
      .from('appointments')
      .insert([{ 
        type: validType,
        doctor: validDoctor,
        specialty: validSpecialty,
        date: nullIfEmpty(data.date),
        time: validTime,
        location: validLocation,
        notes: validNotes,
        user_id: userId,
        active: data.active !== false
      }])
      .select()
      .single();

    if (error) throw error;

    // Agendar notificação para 1 dia antes no mesmo horário do compromisso
    if (created.date && created.active !== false) {
      await notificationService.scheduleAppointmentNotification(
        userId,
        created.id,
        created.specialty || created.doctor || 'Geral',
        created.type || 'Consulta',
        created.date,
        created.time
      );
    }

    return mapAppToCamelCase(created);
  },

  async updateAppointment(userId: string, id: string, data: Partial<Appointment>) {
    const updateData: any = {};
    if (data.type !== undefined) updateData.type = validateStringLength(data.type, 'Tipo de compromisso', 50, true);
    if (data.doctor !== undefined) updateData.doctor = validateStringLength(data.doctor, 'Médico', 100, false) || '';
    if (data.specialty !== undefined) updateData.specialty = validateStringLength(data.specialty, 'Especialidade', 100, false) || '';
    if (data.location !== undefined) updateData.location = validateStringLength(data.location, 'Local', 200, false) || '';
    if (data.notes !== undefined) updateData.notes = validateStringLength(data.notes, 'Observações', 500, false);
    if (data.time !== undefined) updateData.time = validateTimeFormat(data.time, 'Horário do compromisso');
    if (data.date !== undefined) updateData.date = nullIfEmpty(data.date);
    if (data.active !== undefined) updateData.active = data.active;

    const { data: updated, error } = await supabase
      .from('appointments')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    // Se ficou inativo, remover notificações futuras agendadas
    if (updated.active === false) {
      await supabase
        .from('notification_queue')
        .delete()
        .eq('appointment_id', id)
        .eq('sent', false);
    } else if (updated.date) {
      // Re-agendar se a data mudou ou se reativado
      // Remover anteriores primeiro para evitar duplicatas
      await supabase
        .from('notification_queue')
        .delete()
        .eq('appointment_id', id)
        .eq('sent', false);

      await notificationService.scheduleAppointmentNotification(
        userId,
        updated.id,
        updated.specialty || updated.doctor || 'Geral',
        updated.type || 'Consulta',
        updated.date,
        updated.time
      );
    }

    return mapAppToCamelCase(updated);
  },

  async deleteAppointment(userId: string, id: string, keepHistory: boolean = true) {
    if (keepHistory) {
      const { error } = await supabase
        .from('appointments')
        .update({
          deleted: true,
          keep_history: true,
          deleted_at: new Date().toISOString(),
          active: false
        })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      // Remover notificações futuras agendadas
      await supabase
        .from('notification_queue')
        .delete()
        .eq('appointment_id', id)
        .eq('sent', false);
    } else {
      const { error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
    }
  }
};
