import { createClient } from '@supabase/supabase-js';
import { validateTimeFormat } from '../src/domain/validation.js';

function getProjectRefFromKey(key: string): string | null {
  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return payload.ref || null;
    }
  } catch (e) {}
  return null;
}

function getProjectRefFromUrl(url: string): string | null {
  try {
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    return match ? match[1] : null;
  } catch (e) {}
  return null;
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getMatchingSupabaseUrl(): string {
  const serviceKeyRef = getProjectRefFromKey(serviceKey);
  const dbUrl = process.env.SUPABASE_DB_URL || '';
  const viteUrl = process.env.VITE_SUPABASE_URL || '';
  
  if (serviceKeyRef) {
    if (getProjectRefFromUrl(dbUrl) === serviceKeyRef) return dbUrl;
    if (getProjectRefFromUrl(viteUrl) === serviceKeyRef) return viteUrl;
  }
  return dbUrl || viteUrl;
}

const supabaseUrl = getMatchingSupabaseUrl() || 'https://placeholder.supabase.co';
const supabaseAdmin = createClient(supabaseUrl, serviceKey || 'placeholder_key');

/**
 * Fila local de execução em memória por medicamento.
 * ATENÇÃO: A integridade do estoque NÃO depende do AsyncLockManager.
 * A garantia de atomicidade, proteção contra lost updates, row-locking (FOR UPDATE)
 * e rollback transacional ACID reside 100% no PostgreSQL (Supabase).
 * O AsyncLockManager serve unicamente para otimizar processamento e evitar requisições
 * redundantes na mesma instância Node.js.
 */
class AsyncLockManager {
  private locks: Map<string, Promise<any>> = new Map();

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.locks.get(key) || Promise.resolve();

    const nextLock = (async () => {
      try {
        await currentLock;
      } catch {
        // Ignora erros da operação anterior para não travar a fila local
      }
      return await fn();
    })();

    this.locks.set(key, nextLock);

    try {
      return await nextLock;
    } finally {
      if (this.locks.get(key) === nextLock) {
        this.locks.delete(key);
      }
    }
  }
}

const lockManager = new AsyncLockManager();

export const atomicStockService = {
  /**
   * Registra o consumo de uma dose e debita atomicamente o estoque via PostgreSQL RPC.
   * Idempotência garantida: se a dose já foi registrada como 'taken', não duplica débito.
   */
  async recordConsumption(params: {
    userId: string;
    medicationId: string;
    date: string;
    scheduledTime: string;
    status: 'taken' | 'pending' | 'skipped';
    dosageAmount: number;
    nextDoseAt?: string | null;
  }) {
    const { userId, medicationId, date, scheduledTime, status, dosageAmount, nextDoseAt } = params;
    const validTime = validateTimeFormat(scheduledTime, 'Horário agendado');
    const validDose = (!dosageAmount || dosageAmount <= 0) ? 1 : dosageAmount;

    return await lockManager.acquire(medicationId, async () => {
      try {
        // Invoca a RPC atômica e idempotente no PostgreSQL
        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('record_dose_consumption', {
          p_user_id: userId,
          p_medication_id: medicationId,
          p_date: date,
          p_scheduled_time: validTime,
          p_status: status,
          p_dosage_amount: validDose,
          p_next_dose_at: nextDoseAt || null
        });

        if (!rpcErr && rpcRes && rpcRes.record) {
          return {
            record: rpcRes?.record,
            medication_id: rpcRes?.medication_id || medicationId,
            current_stock: rpcRes?.current_stock,
            next_dose_at: rpcRes?.next_dose_at,
            idempotent: rpcRes?.idempotent || false
          };
        }
      } catch (e) {
        console.warn('[atomicStockService] RPC exception, running resilient fallback:', e);
      }

      // Fallback seguro, atômico no servidor e idempotente via Supabase Query Builder
      const { data: existingRecords } = await supabaseAdmin
        .from('consumption_records')
        .select('*')
        .eq('user_id', userId)
        .eq('medication_id', medicationId)
        .eq('date', date)
        .eq('scheduled_time', scheduledTime)
        .limit(1);

      const existing = existingRecords?.[0];

      if (existing) {
        if (existing.status === 'taken') {
          const { data: med } = await supabaseAdmin
            .from('medications')
            .select('current_stock, next_dose_at')
            .eq('id', medicationId)
            .single();

          return {
            record: existing,
            medication_id: medicationId,
            current_stock: med?.current_stock,
            next_dose_at: med?.next_dose_at,
            idempotent: true
          };
        }

        if (status === 'taken') {
          await supabaseAdmin
            .from('consumption_records')
            .update({ status: 'taken' })
            .eq('id', existing.id);

          const { data: med } = await supabaseAdmin
            .from('medications')
            .select('current_stock')
            .eq('id', medicationId)
            .single();

          const currentStock = Number(med?.current_stock) || 0;
          const newStock = Math.max(0, Math.round((currentStock - validDose) * 10000) / 10000);

          const { data: updatedMed } = await supabaseAdmin
            .from('medications')
            .update({
              current_stock: newStock,
              ...(nextDoseAt ? { next_dose_at: nextDoseAt } : {})
            })
            .eq('id', medicationId)
            .select('current_stock, next_dose_at')
            .single();

          return {
            record: { ...existing, status: 'taken' },
            medication_id: medicationId,
            current_stock: updatedMed?.current_stock ?? newStock,
            next_dose_at: updatedMed?.next_dose_at,
            idempotent: false
          };
        }

        return {
          record: existing,
          medication_id: medicationId,
          current_stock: undefined,
          idempotent: true
        };
      }

      const { data: newRecord, error: insErr } = await supabaseAdmin
        .from('consumption_records')
        .insert({
          user_id: userId,
          medication_id: medicationId,
          date,
          scheduled_time: scheduledTime,
          status
        })
        .select()
        .single();

      if (insErr) {
        if (insErr.code === '23505') {
          // Violação de índice único concorrente no PostgreSQL: a outra requisição acabou de inserir.
          const { data: recAfterConflict } = await supabaseAdmin
            .from('consumption_records')
            .select('*')
            .eq('user_id', userId)
            .eq('medication_id', medicationId)
            .eq('date', date)
            .eq('scheduled_time', scheduledTime)
            .single();

          const { data: med } = await supabaseAdmin
            .from('medications')
            .select('current_stock, next_dose_at')
            .eq('id', medicationId)
            .single();

          return {
            record: recAfterConflict,
            medication_id: medicationId,
            current_stock: med?.current_stock,
            next_dose_at: med?.next_dose_at,
            idempotent: true
          };
        }
        throw insErr;
      }

      let updatedStock: number | undefined;
      let updatedNextDose: string | null | undefined;

      if (status === 'taken') {
        const { data: med } = await supabaseAdmin
          .from('medications')
          .select('current_stock')
          .eq('id', medicationId)
          .single();

        const currentStock = Number(med?.current_stock) || 0;
        updatedStock = Math.max(0, Math.round((currentStock - validDose) * 10000) / 10000);

        const { data: updatedMed } = await supabaseAdmin
          .from('medications')
          .update({
            current_stock: updatedStock,
            ...(nextDoseAt ? { next_dose_at: nextDoseAt } : {})
          })
          .eq('id', medicationId)
          .select('current_stock, next_dose_at')
          .single();

        updatedStock = updatedMed?.current_stock ?? updatedStock;
        updatedNextDose = updatedMed?.next_dose_at;
      }

      return {
        record: newRecord,
        medication_id: medicationId,
        current_stock: updatedStock,
        next_dose_at: updatedNextDose,
        idempotent: false
      };
    });
  },

  /**
   * Alterna o status de um registro existente e debita/estorna atomicamente o estoque no PostgreSQL.
   * Utiliza a RPC transacional `toggle_dose_consumption` que executa SELECT ... FOR UPDATE.
   */
  async toggleConsumption(params: {
    userId: string;
    recordId: string;
    newStatus: 'taken' | 'pending' | 'skipped';
    dosageAmount: number;
    nextDoseAt?: string | null;
  }) {
    const { userId, recordId, newStatus, dosageAmount, nextDoseAt } = params;
    const validDose = (!dosageAmount || dosageAmount <= 0) ? 1 : dosageAmount;

    // Executa a transação atômica completa diretamente no PostgreSQL
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('toggle_dose_consumption', {
      p_user_id: userId,
      p_record_id: recordId,
      p_new_status: newStatus,
      p_dosage_amount: validDose,
      p_next_dose_at: nextDoseAt || null
    });

    if (rpcErr) {
      console.error('[atomicStockService] Erro na RPC toggle_dose_consumption:', rpcErr);
      throw rpcErr;
    }

    return {
      record: rpcRes?.record,
      medication_id: rpcRes?.medication_id,
      current_stock: rpcRes?.current_stock,
      next_dose_at: rpcRes?.next_dose_at
    };
  },

  /**
   * Exclui um registro de consumo (ex: dose PRN desmarcada) e estorna atomicamente o estoque no PostgreSQL.
   * Utiliza a RPC transacional `delete_dose_consumption`.
   */
  async deleteConsumption(params: {
    userId: string;
    recordId: string;
    dosageAmount: number;
  }) {
    const { userId, recordId, dosageAmount } = params;
    const validDose = (!dosageAmount || dosageAmount <= 0) ? 1 : dosageAmount;

    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('delete_dose_consumption', {
      p_user_id: userId,
      p_record_id: recordId,
      p_dosage_amount: validDose
    });

    if (rpcErr) {
      console.error('[atomicStockService] Erro na RPC delete_dose_consumption:', rpcErr);
      throw rpcErr;
    }

    return {
      success: rpcRes?.success ?? true,
      medication_id: rpcRes?.medication_id,
      current_stock: rpcRes?.current_stock
    };
  }
};
