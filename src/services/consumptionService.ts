import { supabase } from '../lib/supabase';
import { DoseEvent, Medication } from '../../types';
import { getNextDoseAt } from '../domain/medicationRules';
import { parseDosageAmount } from '../domain/stock';
import { validateTimeFormat } from '../domain/validation';

export const mapDoseToCamelCase = (record: any): DoseEvent => ({
  id: record.id,
  medicationId: record.medication_id,
  date: record.date,
  scheduledTime: record.scheduled_time,
  status: record.status
});

const mapMedToCamelCase = (med: any): Medication => ({
  id: med.id,
  name: med.name,
  dosage: med.dosage,
  unit: med.unit,
  usageCategory: med.usage_category,
  dosesPerDay: med.doses_per_day,
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
  next_dose_at: med.next_dose_at
});

export interface ConsumptionOperationResult {
  dose: DoseEvent;
  medicationId?: string;
  currentStock?: number;
  nextDoseAt?: string;
}

const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return '';
  }
  return 'http://127.0.0.1:3000';
};

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch (err) {
    console.warn('[consumptionService] Erro ao obter token de sessão para os cabeçalhos:', err);
  }
  return headers;
};

export const consumptionService = {
  async getConsumptionRecords(userId: string) {
    const { data, error } = await supabase
      .from('consumption_records')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('scheduled_time', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapDoseToCamelCase);
  },

  /**
   * Registra um evento de dose e debita atomicamente o estoque via PostgreSQL RPC
   */
  async createConsumptionRecord(
    userId: string, 
    data: Omit<DoseEvent, 'id'> & { dosageAmount?: number; nextDoseAt?: string | null }
  ): Promise<ConsumptionOperationResult> {
    const validTime = validateTimeFormat(data.scheduledTime, 'Horário agendado');
    const dosageAmount = data.dosageAmount !== undefined ? data.dosageAmount : 1;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/consumption/record`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId,
          medicationId: data.medicationId,
          date: data.date,
          scheduledTime: validTime,
          status: data.status,
          dosageAmount,
          nextDoseAt: data.nextDoseAt || null
        })
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await res.json();
          if (body?.record) {
            return {
              dose: mapDoseToCamelCase(body.record),
              medicationId: body.medication_id,
              currentStock: body.current_stock,
              nextDoseAt: body.next_dose_at
            };
          }
        }
      } else {
        const errText = await res.text();
        console.error('[consumptionService] API returned error status', res.status, errText);
      }
    } catch (apiErr) {
      console.warn('[consumptionService] API route unavailable, using PostgreSQL RPC fallback:', apiErr);
    }

    // Fallback de segurança atômico e idempotente diretamente via RPC no PostgreSQL
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('record_dose_consumption', {
      p_user_id: userId,
      p_medication_id: data.medicationId,
      p_date: data.date,
      p_scheduled_time: validTime,
      p_status: data.status,
      p_dosage_amount: dosageAmount,
      p_next_dose_at: data.nextDoseAt || null
    });

    if (rpcErr) {
      console.error('[consumptionService] Erro na RPC record_dose_consumption no fallback:', rpcErr);
      throw rpcErr;
    }

    return {
      dose: mapDoseToCamelCase(rpcRes?.record),
      medicationId: rpcRes?.medication_id || data.medicationId,
      currentStock: rpcRes?.current_stock,
      nextDoseAt: rpcRes?.next_dose_at
    };
  },

  /**
   * Exclui um registro de consumo (ex: PRN revertido) e estorna atomicamente o estoque via PostgreSQL RPC
   */
  async deleteConsumptionRecord(userId: string, id: string, dosageAmount?: number) {
    const validDose = dosageAmount !== undefined ? dosageAmount : 1;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/consumption/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId,
          recordId: id,
          dosageAmount: validDose
        })
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await res.json();
          return {
            success: body.success ?? true,
            medicationId: body.medication_id,
            currentStock: body.current_stock
          };
        }
      }
    } catch (apiErr) {
      console.warn('[consumptionService] API delete route unavailable, using direct PostgreSQL RPC fallback:', apiErr);
    }

    // Fallback direto via PostgreSQL RPC
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('delete_dose_consumption', {
      p_user_id: userId,
      p_record_id: id,
      p_dosage_amount: validDose
    });

    if (rpcErr) throw rpcErr;

    return {
      success: rpcRes?.success ?? true,
      medicationId: rpcRes?.medication_id,
      currentStock: rpcRes?.current_stock
    };
  },

  /**
   * Atualiza status do consumo e ajusta/estorna o estoque atomicamente via PostgreSQL RPC
   */
  async updateConsumptionRecord(
    userId: string, 
    id: string, 
    data: Partial<DoseEvent> & { dosageAmount?: number; nextDoseAt?: string | null }
  ): Promise<ConsumptionOperationResult> {
    const validDose = data.dosageAmount !== undefined ? data.dosageAmount : 1;

    if (data.status !== undefined) {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${getApiBaseUrl()}/api/consumption/toggle`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId,
            recordId: id,
            newStatus: data.status,
            dosageAmount: validDose,
            nextDoseAt: data.nextDoseAt || null
          })
        });

        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const body = await res.json();
            if (body?.record) {
              return {
                dose: mapDoseToCamelCase(body.record),
                medicationId: body.medication_id,
                currentStock: body.current_stock,
                nextDoseAt: body.next_dose_at
              };
            }
          }
        }
      } catch (apiErr) {
        console.warn('[consumptionService] API toggle route unavailable, using direct PostgreSQL RPC fallback:', apiErr);
      }

      // Fallback direto via PostgreSQL RPC (transação com FOR UPDATE)
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('toggle_dose_consumption', {
        p_user_id: userId,
        p_record_id: id,
        p_new_status: data.status,
        p_dosage_amount: validDose,
        p_next_dose_at: data.nextDoseAt || null
      });

      if (rpcErr) throw rpcErr;

      return {
        dose: mapDoseToCamelCase(rpcRes.record),
        medicationId: rpcRes.medication_id,
        currentStock: rpcRes.current_stock,
        nextDoseAt: rpcRes.next_dose_at
      };
    }

    const updateData: any = {};
    if (data.date !== undefined) updateData.date = data.date;
    if (data.scheduledTime !== undefined) updateData.scheduled_time = validateTimeFormat(data.scheduledTime, 'Horário agendado');
    if (data.medicationId !== undefined) updateData.medication_id = data.medicationId;

    const { data: updated, error } = await supabase
      .from('consumption_records')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return {
      dose: mapDoseToCamelCase(updated)
    };
  }
};
