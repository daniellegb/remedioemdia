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
    console.log(`[Repository] [getAppointments] ANTES do select appointments para o usuário: ${userId}`);
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('time', { ascending: true });
    console.log(`[Repository] [getAppointments] DEPOIS do select appointments. Error:`, error);

    if (error) throw error;
    return (data || []).map(mapAppToCamelCase);
  },

  async createAppointment(userId: string, data: Omit<Appointment, 'id'>) {
    console.log(`[Repository] [createAppointment] ANTES do insert appointments para o usuário: ${userId}`);
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
    console.log(`[Repository] [createAppointment] DEPOIS do insert appointments. Error:`, error);

    if (error) throw error;

    // Agendar notificação para o dia anterior às 08:00
    if (created.date && created.active !== false) {
      const triggerDate = new Date(created.date);
      triggerDate.setDate(triggerDate.getDate() - 1);
      triggerDate.setHours(8, 0, 0, 0);
      
      console.log(`[Repository] [createAppointment] ANTES do scheduleAppointmentNotification`);
      await notificationService.scheduleAppointmentNotification(
        userId,
        created.id,
        created.doctor || created.specialty || 'Consulta',
        created.type,
        triggerDate.toISOString()
      );
      console.log(`[Repository] [createAppointment] DEPOIS do scheduleAppointmentNotification`);
    }

    return mapAppToCamelCase(created);
  },

  async updateAppointment(userId: string, id: string, data: Partial<Appointment>) {
    const updateData: any = { ...data };
    if (data.date !== undefined) updateData.date = nullIfEmpty(data.date);

    console.log(`[Repository] [updateAppointment] ANTES do update appointments id: ${id}`);
    const { data: updated, error } = await supabase
      .from('appointments')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    console.log(`[Repository] [updateAppointment] DEPOIS do update appointments. Error:`, error);

    if (error) throw error;

    // Se ficou inativo, remover notificações futuras agendadas
    if (updated.active === false) {
      console.log(`[Repository] [updateAppointment] ANTES do delete de notificações inativas`);
      await supabase
        .from('notification_queue')
        .delete()
        .eq('appointment_id', id)
        .eq('sent', false);
      console.log(`[Repository] [updateAppointment] DEPOIS do delete de notificações inativas`);
    } else if (updated.date) {
      // Re-agendar se a data mudou ou se reativado
      // Remover anteriores primeiro para evitar duplicatas
      console.log(`[Repository] [updateAppointment] ANTES do delete de notificações anteriores`);
      await supabase
        .from('notification_queue')
        .delete()
        .eq('appointment_id', id)
        .eq('sent', false);
      console.log(`[Repository] [updateAppointment] DEPOIS do delete de notificações anteriores`);

      const triggerDate = new Date(updated.date);
      triggerDate.setDate(triggerDate.getDate() - 1);
      triggerDate.setHours(8, 0, 0, 0);
      
      console.log(`[Repository] [updateAppointment] ANTES de re-agendar scheduleAppointmentNotification`);
      await notificationService.scheduleAppointmentNotification(
        userId,
        updated.id,
        updated.doctor || updated.specialty || 'Consulta',
        updated.type,
        triggerDate.toISOString()
      );
      console.log(`[Repository] [updateAppointment] DEPOIS de re-agendar scheduleAppointmentNotification`);
    }

    return mapAppToCamelCase(updated);
  },

  async deleteAppointment(userId: string, id: string, keepHistory: boolean = true) {
    console.log(`[Repository] [deleteAppointment] ANTES do delete de compromisso id: ${id}, keepHistory: ${keepHistory}`);
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

      console.log(`[Repository] [deleteAppointment] DEPOIS do update soft-delete compromisso. Error:`, error);
      if (error) throw error;

      // Remover notificações futuras agendadas
      console.log(`[Repository] [deleteAppointment] ANTES de remover notificações futuras`);
      await supabase
        .from('notification_queue')
        .delete()
        .eq('appointment_id', id)
        .eq('sent', false);
      console.log(`[Repository] [deleteAppointment] DEPOIS de remover notificações futuras`);
    } else {
      const { error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      console.log(`[Repository] [deleteAppointment] DEPOIS do delete físico de compromisso. Error:`, error);
      if (error) throw error;
    }
  }
};
