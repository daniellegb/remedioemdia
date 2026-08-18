import { supabase } from '../lib/supabase';
import { Appointment } from '../../types';
import { notificationService } from './notificationService';

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
    const { data: created, error } = await supabase
      .from('appointments')
      .insert([{ 
        type: data.type,
        doctor: data.doctor,
        specialty: data.specialty,
        date: nullIfEmpty(data.date),
        time: data.time,
        location: data.location,
        notes: data.notes,
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
    const updateData: any = { ...data };
    if (data.date !== undefined) updateData.date = nullIfEmpty(data.date);

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
