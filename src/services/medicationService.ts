import { supabase } from '../lib/supabase';
import { Medication } from '../../types';
import { getNextDoseAt } from '../domain/medicationRules';

export const mapMedToCamelCase = (med: any): Medication => ({
  id: med.id,
  name: med.name,
  dosage: med.dosage,
  unit: med.unit,
  usageCategory: med.usage_category,
  dosesPerDay: med.doses_per_day ? (typeof med.doses_per_day === 'number' ? `${med.doses_per_day}x` : med.doses_per_day) : '1x',
  intervalDays: med.interval_days,
  times: med.times,
  intervalType: med.interval_type,
  contraceptiveType: med.contraceptive_type,
  startDate: med.start_date,
  endDate: med.end_date,
  durationDays: med.duration_days,
  maxDosesPerDay: med.max_doses_per_day,
  totalStock: med.total_stock,
  currentStock: med.current_stock,
  expiryDate: med.expiry_date,
  notes: med.notes,
  color: med.color,
  frequency: med.frequency || 1,
  next_dose_at: med.next_dose_at,
  active: med.active !== false && med.active !== 'false' && med.active !== 0,
  deleted: med.deleted === true,
  keep_history: med.keep_history !== false,
  deleted_at: med.deleted_at
});

const nullIfEmpty = (val: string | undefined | null) => {
  if (val === undefined || val === null || val.trim() === '') return null;
  return val;
};

export const medicationService = {
  async getMedications(userId: string) {
    console.log(`[Repository] [getMedications] Entrando para usuário: ${userId}`);
    try {
      console.log(`[Repository] [getMedications] Antes do select medications`);
      const { data, error } = await supabase
        .from('medications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      console.log(`[Repository] [getMedications] Depois do select medications`);
      if (error) {
        console.error(`[Repository] [getMedications] Erro retornado pelo Supabase:`, error);
        throw error;
      }
      return (data || []).map(mapMedToCamelCase);
    } catch (err: any) {
      console.error(`[Repository] [getMedications] Exceção capturada:`, err?.message || err);
      throw err;
    }
  },

  async createMedication(userId: string, data: Omit<Medication, 'id'>) {
    console.log(`[Repository] [createMedication] Entrando para usuário: ${userId}, med: ${data.name}`);
    try {
      const nextDoseAt = getNextDoseAt(data as Medication);
      
      // Sanitização para evitar erros de tipo no Supabase (colunas INTEGER vs strings '1x')
      const dosesPerDayInt = data.dosesPerDay ? parseInt(data.dosesPerDay) : 1;
      
      console.log(`[Repository] [createMedication] Antes do insert medications`);
      const { data: created, error } = await supabase
        .from('medications')
        .insert([{ 
          name: data.name,
          dosage: data.dosage,
          unit: data.unit,
          usage_category: data.usageCategory,
          doses_per_day: isNaN(dosesPerDayInt) ? null : dosesPerDayInt,
          interval_days: data.intervalDays,
          times: data.times,
          interval_type: data.intervalType,
          contraceptive_type: data.contraceptiveType,
          start_date: nullIfEmpty(data.startDate),
          end_date: nullIfEmpty(data.endDate),
          duration_days: data.durationDays,
          max_doses_per_day: data.maxDosesPerDay,
          total_stock: data.totalStock,
          current_stock: data.currentStock,
          expiry_date: nullIfEmpty(data.expiryDate),
          notes: data.notes,
          color: data.color,
          frequency: data.frequency || 1,
          user_id: userId,
          next_dose_at: nextDoseAt,
          active: data.active !== false
        }])
        .select()
        .single();

      console.log(`[Repository] [createMedication] Depois do insert medications`);
      if (error) {
        console.error(`[Repository] [createMedication] Erro retornado pelo Supabase:`, error);
        throw error;
      }
      return mapMedToCamelCase(created);
    } catch (err: any) {
      console.error(`[Repository] [createMedication] Exceção capturada:`, err?.message || err);
      throw err;
    }
  },

  async updateMedication(userId: string, id: string, data: Partial<Medication>) {
    console.log(`[Repository] [updateMedication] Entrando para usuário: ${userId}, medId: ${id}`);
    try {
      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.dosage !== undefined) updateData.dosage = data.dosage;
      if (data.unit !== undefined) updateData.unit = data.unit;
      if (data.usageCategory !== undefined) updateData.usage_category = data.usageCategory;
      if (data.dosesPerDay !== undefined) {
        const dosesPerDayInt = parseInt(data.dosesPerDay);
        updateData.doses_per_day = isNaN(dosesPerDayInt) ? null : dosesPerDayInt;
      }
      if (data.intervalDays !== undefined) updateData.interval_days = data.intervalDays;
      if (data.times !== undefined) updateData.times = data.times;
      if (data.intervalType !== undefined) updateData.interval_type = data.intervalType;
      if (data.contraceptiveType !== undefined) updateData.contraceptive_type = data.contraceptiveType;
      if (data.startDate !== undefined) updateData.start_date = nullIfEmpty(data.startDate);
      if (data.endDate !== undefined) updateData.end_date = nullIfEmpty(data.endDate);
      if (data.durationDays !== undefined) updateData.duration_days = data.durationDays;
      if (data.maxDosesPerDay !== undefined) updateData.max_doses_per_day = data.maxDosesPerDay;
      if (data.totalStock !== undefined) updateData.total_stock = data.totalStock;
      if (data.currentStock !== undefined) updateData.current_stock = data.currentStock;
      if (data.expiryDate !== undefined) updateData.expiry_date = nullIfEmpty(data.expiryDate);
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.color !== undefined) updateData.color = data.color;
      if (data.frequency !== undefined) updateData.frequency = data.frequency;
      if (data.active !== undefined) updateData.active = data.active;
      if (data.deleted !== undefined) updateData.deleted = data.deleted;

      // Recalcular próxima dose se campos relevantes mudarem
      if (data.times || data.intervalDays || data.usageCategory || data.startDate) {
        console.log(`[Repository] [updateMedication] Recalculando próxima dose. Buscando med atual...`);
        const { data: current } = await supabase.from('medications').select('*').eq('id', id).single();
        if (current) {
          const fullMed = mapMedToCamelCase({ ...current, ...updateData });
          updateData.next_dose_at = getNextDoseAt(fullMed);
        }
      } else if (data.next_dose_at !== undefined) {
        updateData.next_dose_at = data.next_dose_at;
      }

      console.log(`[Repository] [updateMedication] Antes do update medications`);
      const { data: updated, error } = await supabase
        .from('medications')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      console.log(`[Repository] [updateMedication] Depois do update medications`);
      if (error) {
        console.error(`[Repository] [updateMedication] Erro retornado pelo Supabase:`, error);
        throw error;
      }
      return mapMedToCamelCase(updated);
    } catch (err: any) {
      console.error(`[Repository] [updateMedication] Exceção capturada:`, err?.message || err);
      throw err;
    }
  },

  async deleteMedication(userId: string, id: string, keepHistory: boolean = true) {
    console.log(`[Repository] [deleteMedication] Entrando para usuário: ${userId}, medId: ${id}, keepHistory: ${keepHistory}`);
    try {
      if (keepHistory) {
        console.log(`[Repository] [deleteMedication] Antes de marcar como deletado (keepHistory=true)`);
        const { error } = await supabase
          .from('medications')
          .update({
            deleted: true,
            keep_history: true,
            deleted_at: new Date().toISOString(),
            active: false,
            next_dose_at: null
          })
          .eq('id', id)
          .eq('user_id', userId);

        console.log(`[Repository] [deleteMedication] Depois de marcar como deletado (keepHistory=true)`);
        if (error) {
          console.error(`[Repository] [deleteMedication] Erro no update do soft delete:`, error);
          throw error;
        }

        // Inativar também os lembretes automáticos na tabela medication_reminders
        console.log(`[Repository] [deleteMedication] Antes de desativar lembretes`);
        await supabase
          .from('medication_reminders')
          .update({ active: false })
          .eq('medication_id', id)
          .eq('user_id', userId);
        console.log(`[Repository] [deleteMedication] Depois de desativar lembretes`);
      } else {
        console.log(`[Repository] [deleteMedication] Antes do delete físico (keepHistory=false)`);
        const { error } = await supabase
          .from('medications')
          .delete()
          .eq('id', id)
          .eq('user_id', userId);

        console.log(`[Repository] [deleteMedication] Depois do delete físico (keepHistory=false)`);
        if (error) {
          console.error(`[Repository] [deleteMedication] Erro no delete físico:`, error);
          throw error;
        }
      }
    } catch (err: any) {
      console.error(`[Repository] [deleteMedication] Exceção capturada:`, err?.message || err);
      throw err;
    }
  }
};
