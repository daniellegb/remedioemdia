import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

// Import Stripe server handlers
import checkoutHandler from './api/stripe/checkout.js';
import portalHandler from './api/stripe/create-portal-session.js';
import syncHandler from './api/stripe/sync-subscription.js';
import webhookHandler from './api/stripe/webhook.js';

// Import Consumption server handlers
import recordConsumptionHandler from './api/consumption/record.js';
import toggleConsumptionHandler from './api/consumption/toggle.js';
import deleteConsumptionHandler from './api/consumption/delete.js';

import { atomicStockService } from './server/atomicStockService';

function getProjectRefFromUrl(url: string): string | null {
  try {
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    return match ? match[1] : null;
  } catch (e) {
    // Ignore parsing errors
  }
  return null;
}

// Initialize Supabase Admin client with dynamic project matching
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY || '';

function getMatchingSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    return url;
  }
  throw new Error('[Supabase Config Error] URL HTTP/HTTPS do Supabase não configurada. Defina SUPABASE_URL ou VITE_SUPABASE_URL.');
}

const supabaseUrl = getMatchingSupabaseUrl();
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const activeRef = getProjectRefFromUrl(supabaseUrl);
const viteRef = getProjectRefFromUrl(process.env.VITE_SUPABASE_URL || '');
if (viteRef && activeRef && viteRef !== activeRef) {
  console.error(`[SUPABASE CONFIG MISMATCH WARNING]
  O frontend está configurado com o projeto Supabase: "${viteRef}" (VITE_SUPABASE_URL)
  O backend está configurado com o projeto Supabase: "${activeRef}" (SUPABASE_DB_URL)
  Isso causará falhas de sincronização de assinatura e autenticação porque eles usam bancos de dados diferentes!
  Por favor, atualize as credenciais no menu Settings do AI Studio para que apontem para o mesmo projeto.`);
}

/**
 * Runs PostgreSQL column migrations on startup to support account deletion tracking.
 */
async function runSchemaMigration() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.startsWith('http://') || dbUrl.startsWith('https://')) {
    console.warn('[Migration] SUPABASE_DB_URL ausente ou não é uma URL postgres:// válida. Ppulando migração direta no PostgreSQL.');
    return;
  }
  
  try {
    console.log('[Migration] Conectando ao banco PostgreSQL para verificar colunas de exclusão de conta...');
    const sql = postgres(dbUrl, { ssl: 'require', connect_timeout: 10, max: 1 });
    
    await sql`
      ALTER TABLE public.profiles 
      ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active' CHECK (account_status IN ('active', 'pending_deletion')),
      ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS plan_mismatch_pending BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS legal_acceptance_at TIMESTAMP WITH TIME ZONE;
    `;

    await sql`
      ALTER TABLE public.medications
      ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS keep_history BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
      ALTER COLUMN current_stock TYPE NUMERIC,
      ALTER COLUMN total_stock TYPE NUMERIC;
    `;

    await sql`
      ALTER TABLE public.appointments
      ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS keep_history BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    `;
    
    console.log('[Migration] Configurando limites de plano (Gratuito vs Premium) e triggers...');
    await sql`
      CREATE OR REPLACE FUNCTION public.has_premium_access(user_uuid UUID)
      RETURNS BOOLEAN AS $$
      DECLARE
          u_plan TEXT;
          u_lifetime BOOLEAN;
          u_trial_ends TIMESTAMP WITH TIME ZONE;
          u_sub_status TEXT;
          u_sub_ends TIMESTAMP WITH TIME ZONE;
          now_tz TIMESTAMP WITH TIME ZONE := now();
      BEGIN
          SELECT plan, lifetime_access, trial_ends_at, subscription_status, subscription_ends_at
          INTO u_plan, u_lifetime, u_trial_ends, u_sub_status, u_sub_ends
          FROM public.profiles
          WHERE id = user_uuid;

          -- Se não encontrar o perfil, assume como gratuito
          IF NOT FOUND THEN
              RETURN FALSE;
          END IF;

          -- Verificação direta de plano premium ou acesso vitalício
          IF u_plan = 'premium' OR u_plan = 'lifetime_access' OR u_lifetime = TRUE THEN
              RETURN TRUE;
          END IF;

          -- Verificação de período de avaliação ativo
          IF u_trial_ends IS NOT NULL AND now_tz < u_trial_ends THEN
              RETURN TRUE;
          END IF;

          -- Verificação de assinatura ativa ou cancelada porém dentro do prazo pago
          -- Só confere acesso premium se o plano cadastrado for premium
          IF COALESCE(u_plan, 'free') = 'premium' AND u_sub_status = 'active' THEN
              IF u_sub_ends IS NULL OR now_tz < u_sub_ends THEN
                  RETURN TRUE;
              END IF;
          END IF;

          IF COALESCE(u_plan, 'free') = 'premium' AND u_sub_status = 'canceled' AND u_sub_ends IS NOT NULL AND now_tz < u_sub_ends THEN
              RETURN TRUE;
          END IF;

          RETURN FALSE;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    await sql`
      CREATE OR REPLACE FUNCTION public.enforce_medications_limit()
      RETURNS TRIGGER AS $$
      DECLARE
          med_count INTEGER;
          is_premium BOOLEAN;
      BEGIN
          is_premium := public.has_premium_access(NEW.user_id);
          
          IF NOT is_premium AND COALESCE(NEW.active, true) = true AND (TG_OP = 'INSERT' OR COALESCE(OLD.active, true) = false) THEN
              SELECT COUNT(*) INTO med_count
              FROM public.medications
              WHERE user_id = NEW.user_id AND COALESCE(active, true) = true AND COALESCE(deleted, false) = false;
              
              IF med_count >= 3 THEN
                  RAISE EXCEPTION 'Limite do Plano Gratuito atingido: Você já cadastrou os 3 medicamentos ativos disponíveis.'
                      USING ERRCODE = 'P9999';
              END IF;
          END IF;
          
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    await sql`
      CREATE OR REPLACE FUNCTION public.enforce_appointments_limit()
      RETURNS TRIGGER AS $$
      DECLARE
          app_count INTEGER;
          is_premium BOOLEAN;
      BEGIN
          is_premium := public.has_premium_access(NEW.user_id);
          
          IF NOT is_premium AND COALESCE(NEW.active, true) = true AND (TG_OP = 'INSERT' OR COALESCE(OLD.active, true) = false) THEN
              SELECT COUNT(*) INTO app_count
              FROM public.appointments
              WHERE user_id = NEW.user_id AND COALESCE(active, true) = true AND COALESCE(deleted, false) = false;
              
              IF app_count >= 5 THEN
                  RAISE EXCEPTION 'Limite do Plano Gratuito atingido: Você já cadastrou os 5 compromissos ativos disponíveis.'
                      USING ERRCODE = 'P9998';
              END IF;
          END IF;
          
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    await sql`
      DROP TRIGGER IF EXISTS trigger_enforce_medications_limit ON public.medications;
      CREATE TRIGGER trigger_enforce_medications_limit
          BEFORE INSERT OR UPDATE ON public.medications
          FOR EACH ROW
          EXECUTE FUNCTION public.enforce_medications_limit();
    `;

    await sql`
      DROP TRIGGER IF EXISTS trigger_enforce_appointments_limit ON public.appointments;
      CREATE TRIGGER trigger_enforce_appointments_limit
          BEFORE INSERT OR UPDATE ON public.appointments
          FOR EACH ROW
          EXECUTE FUNCTION public.enforce_appointments_limit();
    `;
    console.log('[Migration] Triggers e funções de limite de plano criados/atualizados com sucesso!');
    
    console.log('[Migration] Verificando se a tabela public.active_sessions existe com a nova estrutura de chaves...');
    
    // Check primary key of public.active_sessions to migrate safely if needed
    let isSessionIdPK = false;
    try {
      const keyCheck = await sql`
        SELECT a.attname
        FROM   pg_index i
        JOIN   pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE  i.indrelid = 'public.active_sessions'::regclass
        AND    i.indisprimary;
      `;
      isSessionIdPK = keyCheck.some(row => row.attname === 'session_id');
      
      if (keyCheck.length > 0 && !isSessionIdPK) {
        console.log('[Migration] Estrutura antiga de active_sessions detectada. Recriando tabela para suportar replicação Realtime...');
        await sql`DROP TABLE IF EXISTS public.active_sessions CASCADE;`;
      }
    } catch (e) {
      // Table doesn't exist yet, which is expected on first run
      console.log('[Migration] Tabela active_sessions será criada pela primeira vez.');
    }

    await sql`
      CREATE TABLE IF NOT EXISTS public.active_sessions (
        session_id TEXT PRIMARY KEY,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
        last_activity TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
        user_agent TEXT,
        os TEXT,
        browser TEXT,
        device_type TEXT
      );
    `;

    console.log('[Migration] Ativando Row Level Security na tabela active_sessions...');
    await sql`ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;`;

    // Drop policies to recreate them cleanly (idempotent)
    await sql`DROP POLICY IF EXISTS "Users can view their own active sessions" ON public.active_sessions;`;
    await sql`DROP POLICY IF EXISTS "Users can insert their own active sessions" ON public.active_sessions;`;
    await sql`DROP POLICY IF EXISTS "Users can update their own active sessions" ON public.active_sessions;`;
    await sql`DROP POLICY IF EXISTS "Users can delete their own active sessions" ON public.active_sessions;`;

    console.log('[Migration] Criando políticas de segurança RLS para active_sessions...');
    await sql`
      CREATE POLICY "Users can view their own active sessions" 
      ON public.active_sessions FOR SELECT 
      TO authenticated 
      USING (auth.uid() = user_id);
    `;

    await sql`
      CREATE POLICY "Users can insert their own active sessions" 
      ON public.active_sessions FOR INSERT 
      TO authenticated 
      WITH CHECK (auth.uid() = user_id);
    `;

    await sql`
      CREATE POLICY "Users can update their own active sessions" 
      ON public.active_sessions FOR UPDATE 
      TO authenticated 
      USING (auth.uid() = user_id) 
      WITH CHECK (auth.uid() = user_id);
    `;

    await sql`
      CREATE POLICY "Users can delete their own active sessions" 
      ON public.active_sessions FOR DELETE 
      TO authenticated 
      USING (auth.uid() = user_id);
    `;

    console.log('[Migration] Colunas de exclusão e tabela de sessões verificadas/criadas com sucesso no banco de dados!');

    console.log('[Migration] Criando/atualizando funções RPC atômicas para estoque e consumo...');
    await sql`
      -- Garantir políticas de RLS completas para consumption_records
      DROP POLICY IF EXISTS "Users can manage own consumption" ON public.consumption_records;
      DROP POLICY IF EXISTS "Allow all for authenticated and service_role" ON public.consumption_records;
      DROP POLICY IF EXISTS "Users and service can manage consumption" ON public.consumption_records;
      
      CREATE POLICY "Users and service can manage consumption" 
      ON public.consumption_records FOR ALL 
      TO authenticated, anon, service_role
      USING (true)
      WITH CHECK (true);

      -- Drop all existing overloads of record_dose_consumption unambiguously
      DROP FUNCTION IF EXISTS public.record_dose_consumption(UUID, UUID, DATE, TEXT, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE);
      DROP FUNCTION IF EXISTS public.record_dose_consumption(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE);

      CREATE OR REPLACE FUNCTION public.record_dose_consumption(
          p_user_id UUID,
          p_medication_id UUID,
          p_date DATE,
          p_scheduled_time TEXT,
          p_status TEXT,
          p_dosage_amount NUMERIC,
          p_next_dose_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
      )
      RETURNS JSONB AS $$
      DECLARE
          v_record JSONB;
          v_existing_id UUID;
          v_existing_status TEXT;
          v_med_stock NUMERIC;
          v_updated_stock NUMERIC;
          v_updated_next_dose TIMESTAMP WITH TIME ZONE;
          v_valid_dose NUMERIC;
          v_med_user_id UUID;
      BEGIN
          -- 0. Autorização do solicitante (Identity Alignment)
          IF auth.role() = 'anon' THEN
              RAISE EXCEPTION 'Acesso não autorizado: perfil anônimo' USING ERRCODE = '42501';
          END IF;

          IF auth.role() = 'authenticated' AND (auth.uid() IS NULL OR auth.uid() != p_user_id) THEN
              RAISE EXCEPTION 'Acesso negado: ID de usuário desalinhado com a sessão autenticada' USING ERRCODE = '42501';
          END IF;

          -- Validar a dosagem
          v_valid_dose := CASE 
              WHEN p_dosage_amount IS NULL OR p_dosage_amount <= 0 THEN 1 
              ELSE p_dosage_amount 
          END;

          -- 1. Lock de linha no medicamento e verificação de propriedade do recurso
          SELECT current_stock, next_dose_at, user_id INTO v_med_stock, v_updated_next_dose, v_med_user_id
          FROM public.medications
          WHERE id = p_medication_id
          FOR UPDATE;

          IF NOT FOUND THEN
              RAISE EXCEPTION 'Medicamento não encontrado' USING ERRCODE = 'P0002';
          END IF;

          IF v_med_user_id != p_user_id THEN
              RAISE EXCEPTION 'Medicamento não pertence ao usuário especificado' USING ERRCODE = '42501';
          END IF;

          -- 2. Verificar se a dose já foi registrada (Idempotência)
          SELECT id, status INTO v_existing_id, v_existing_status
          FROM public.consumption_records
          WHERE user_id = p_user_id 
            AND medication_id = p_medication_id 
            AND date = p_date 
            AND scheduled_time = p_scheduled_time
          FOR UPDATE;

          IF v_existing_id IS NOT NULL THEN
              -- Registro já existe no banco
              IF v_existing_status = 'taken' THEN
                  -- Já tomada anteriormente: Retornar idempotente sem novo débito no estoque
                  SELECT to_jsonb(r) INTO v_record FROM (
                      SELECT id, user_id, medication_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, scheduled_time, status, created_at
                      FROM public.consumption_records
                      WHERE id = v_existing_id
                  ) r;

                  RETURN jsonb_build_object(
                      'record', v_record,
                      'medication_id', p_medication_id,
                      'current_stock', v_med_stock,
                      'next_dose_at', v_updated_next_dose,
                      'idempotent', true
                  );
              ELSIF p_status = 'taken' THEN
                  -- Mudar de pending/missed para taken na mesma transação
                  UPDATE public.consumption_records
                  SET status = 'taken'
                  WHERE id = v_existing_id;

                  UPDATE public.medications
                  SET 
                      current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) - v_valid_dose)::numeric, 4)),
                      next_dose_at = COALESCE(p_next_dose_at, next_dose_at)
                  WHERE id = p_medication_id AND user_id = p_user_id
                  RETURNING current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose;

                  SELECT to_jsonb(r) INTO v_record FROM (
                      SELECT id, user_id, medication_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, scheduled_time, status, created_at
                      FROM public.consumption_records
                      WHERE id = v_existing_id
                  ) r;

                  RETURN jsonb_build_object(
                      'record', v_record,
                      'medication_id', p_medication_id,
                      'current_stock', v_updated_stock,
                      'next_dose_at', v_updated_next_dose,
                      'idempotent', false
                  );
              ELSE
                  -- Atualização simples de status para não-taken
                  UPDATE public.consumption_records
                  SET status = p_status
                  WHERE id = v_existing_id;

                  SELECT to_jsonb(r) INTO v_record FROM (
                      SELECT id, user_id, medication_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, scheduled_time, status, created_at
                      FROM public.consumption_records
                      WHERE id = v_existing_id
                  ) r;

                  RETURN jsonb_build_object(
                      'record', v_record,
                      'medication_id', p_medication_id,
                      'current_stock', v_med_stock,
                      'next_dose_at', v_updated_next_dose,
                      'idempotent', true
                  );
              END IF;
          END IF;

          -- 3. Registro novo (Não existente) - Inserir consumo e abater estoque em uma ÚNICA transação
          INSERT INTO public.consumption_records (user_id, medication_id, date, scheduled_time, status)
          VALUES (p_user_id, p_medication_id, p_date, p_scheduled_time, p_status)
          RETURNING id INTO v_existing_id;

          IF p_status = 'taken' THEN
              UPDATE public.medications
              SET 
                  current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) - v_valid_dose)::numeric, 4)),
                  next_dose_at = COALESCE(p_next_dose_at, next_dose_at)
              WHERE id = p_medication_id AND user_id = p_user_id
              RETURNING current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose;
          ELSE
              v_updated_stock := v_med_stock;
          END IF;

          SELECT to_jsonb(r) INTO v_record FROM (
              SELECT id, user_id, medication_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, scheduled_time, status, created_at
              FROM public.consumption_records
              WHERE id = v_existing_id
          ) r;

          RETURN jsonb_build_object(
              'record', v_record,
              'medication_id', p_medication_id,
              'current_stock', v_updated_stock,
              'next_dose_at', v_updated_next_dose,
              'idempotent', false
          );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

      DROP FUNCTION IF EXISTS public.toggle_dose_consumption(UUID, UUID, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE);
      CREATE OR REPLACE FUNCTION public.toggle_dose_consumption(
          p_user_id UUID,
          p_record_id UUID,
          p_new_status TEXT,
          p_dosage_amount NUMERIC,
          p_next_dose_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
      )
      RETURNS JSONB AS $$
      DECLARE
          v_record JSONB;
          v_old_status TEXT;
          v_med_id UUID;
          v_rec_user_id UUID;
          v_med_user_id UUID;
          v_updated_stock NUMERIC;
          v_updated_next_dose TIMESTAMP WITH TIME ZONE;
          v_valid_dose NUMERIC;
      BEGIN
          -- 0. Autorização do solicitante (Identity Alignment)
          IF auth.role() = 'anon' THEN
              RAISE EXCEPTION 'Acesso não autorizado: perfil anônimo' USING ERRCODE = '42501';
          END IF;

          IF auth.role() = 'authenticated' AND (auth.uid() IS NULL OR auth.uid() != p_user_id) THEN
              RAISE EXCEPTION 'Acesso negado: ID de usuário desalinhado com a sessão autenticada' USING ERRCODE = '42501';
          END IF;

          v_valid_dose := CASE 
              WHEN p_dosage_amount IS NULL OR p_dosage_amount <= 0 THEN 1 
              ELSE p_dosage_amount 
          END;

          -- 1. Obter registro de consumo e verificar propriedade do recurso
          SELECT status, medication_id, user_id INTO v_old_status, v_med_id, v_rec_user_id
          FROM public.consumption_records
          WHERE id = p_record_id
          FOR UPDATE;

          IF NOT FOUND THEN
              RAISE EXCEPTION 'Registro de consumo não encontrado' USING ERRCODE = 'P0002';
          END IF;

          IF v_rec_user_id != p_user_id THEN
              RAISE EXCEPTION 'Registro de consumo não pertence ao usuário especificado' USING ERRCODE = '42501';
          END IF;

          -- 2. Verificar propriedade do medicamento associado
          SELECT user_id INTO v_med_user_id
          FROM public.medications
          WHERE id = v_med_id
          FOR UPDATE;

          IF NOT FOUND THEN
              RAISE EXCEPTION 'Medicamento associado não encontrado' USING ERRCODE = 'P0002';
          END IF;

          IF v_med_user_id != p_user_id THEN
              RAISE EXCEPTION 'Medicamento associado não pertence ao usuário especificado' USING ERRCODE = '42501';
          END IF;

          -- 3. Atualizar o registro de consumo
          UPDATE public.consumption_records
          SET status = p_new_status
          WHERE id = p_record_id AND user_id = p_user_id;

          -- 4. Ajustar estoque atomicamente no PostgreSQL
          IF v_old_status = 'taken' AND p_new_status != 'taken' THEN
              UPDATE public.medications
              SET current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) + v_valid_dose)::numeric, 4))
              WHERE id = v_med_id AND user_id = p_user_id
              RETURNING current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose;
          ELSIF v_old_status != 'taken' AND p_new_status = 'taken' THEN
              UPDATE public.medications
              SET 
                  current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) - v_valid_dose)::numeric, 4)),
                  next_dose_at = COALESCE(p_next_dose_at, next_dose_at)
              WHERE id = v_med_id AND user_id = p_user_id
              RETURNING current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose;
          ELSE
              SELECT current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose
              FROM public.medications
              WHERE id = v_med_id AND user_id = p_user_id;
          END IF;

          SELECT to_jsonb(r) INTO v_record FROM (
              SELECT id, user_id, medication_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, scheduled_time, status, created_at
              FROM public.consumption_records
              WHERE id = p_record_id
          ) r;

          RETURN jsonb_build_object(
              'record', v_record,
              'medication_id', v_med_id,
              'current_stock', v_updated_stock,
              'next_dose_at', v_updated_next_dose
          );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

      DROP FUNCTION IF EXISTS public.delete_dose_consumption(UUID, UUID, NUMERIC);
      CREATE OR REPLACE FUNCTION public.delete_dose_consumption(
          p_user_id UUID,
          p_record_id UUID,
          p_dosage_amount NUMERIC
      )
      RETURNS JSONB AS $$
      DECLARE
          v_old_status TEXT;
          v_med_id UUID;
          v_rec_user_id UUID;
          v_med_user_id UUID;
          v_updated_stock NUMERIC;
          v_valid_dose NUMERIC;
      BEGIN
          -- 0. Autorização do solicitante (Identity Alignment)
          IF auth.role() = 'anon' THEN
              RAISE EXCEPTION 'Acesso não autorizado: perfil anônimo' USING ERRCODE = '42501';
          END IF;

          IF auth.role() = 'authenticated' AND (auth.uid() IS NULL OR auth.uid() != p_user_id) THEN
              RAISE EXCEPTION 'Acesso negado: ID de usuário desalinhado com a sessão autenticada' USING ERRCODE = '42501';
          END IF;

          v_valid_dose := CASE 
              WHEN p_dosage_amount IS NULL OR p_dosage_amount <= 0 THEN 1 
              ELSE p_dosage_amount 
          END;

          -- 1. Obter registro de consumo e verificar propriedade do recurso
          SELECT status, medication_id, user_id INTO v_old_status, v_med_id, v_rec_user_id
          FROM public.consumption_records
          WHERE id = p_record_id
          FOR UPDATE;

          IF NOT FOUND THEN
              RAISE EXCEPTION 'Registro de consumo não encontrado' USING ERRCODE = 'P0002';
          END IF;

          IF v_rec_user_id != p_user_id THEN
              RAISE EXCEPTION 'Registro de consumo não pertence ao usuário especificado' USING ERRCODE = '42501';
          END IF;

          -- 2. Verificar propriedade do medicamento associado
          SELECT user_id INTO v_med_user_id
          FROM public.medications
          WHERE id = v_med_id
          FOR UPDATE;

          IF NOT FOUND THEN
              RAISE EXCEPTION 'Medicamento associado não encontrado' USING ERRCODE = 'P0002';
          END IF;

          IF v_med_user_id != p_user_id THEN
              RAISE EXCEPTION 'Medicamento associado não pertence ao usuário especificado' USING ERRCODE = '42501';
          END IF;

          -- 3. Deletar registro e estornar estoque se 'taken'
          DELETE FROM public.consumption_records
          WHERE id = p_record_id AND user_id = p_user_id;

          IF v_old_status = 'taken' THEN
              UPDATE public.medications
              SET current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) + v_valid_dose)::numeric, 4))
              WHERE id = v_med_id AND user_id = p_user_id
              RETURNING current_stock INTO v_updated_stock;
          ELSE
              SELECT current_stock INTO v_updated_stock
              FROM public.medications
              WHERE id = v_med_id AND user_id = p_user_id;
          END IF;

          RETURN jsonb_build_object(
              'success', true,
              'medication_id', v_med_id,
              'current_stock', v_updated_stock
          );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

      DROP FUNCTION IF EXISTS public.adjust_medication_stock(UUID, UUID, NUMERIC, TIMESTAMP WITH TIME ZONE);
      CREATE OR REPLACE FUNCTION public.adjust_medication_stock(
          p_user_id UUID,
          p_medication_id UUID,
          p_delta NUMERIC,
          p_next_dose_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
      )
      RETURNS JSONB AS $$
      DECLARE
          v_updated_stock NUMERIC;
          v_updated_next_dose TIMESTAMP WITH TIME ZONE;
      BEGIN
          UPDATE public.medications
          SET 
              current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) + p_delta)::numeric, 4)),
              next_dose_at = COALESCE(p_next_dose_at, next_dose_at)
          WHERE id = p_medication_id AND user_id = p_user_id
          RETURNING current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose;

          RETURN jsonb_build_object(
              'medication_id', p_medication_id,
              'current_stock', v_updated_stock,
              'next_dose_at', v_updated_next_dose
          );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

      REVOKE EXECUTE ON FUNCTION public.record_dose_consumption(UUID, UUID, DATE, TEXT, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon;
      REVOKE EXECUTE ON FUNCTION public.toggle_dose_consumption(UUID, UUID, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon;
      REVOKE EXECUTE ON FUNCTION public.delete_dose_consumption(UUID, UUID, NUMERIC) FROM PUBLIC, anon;

      GRANT EXECUTE ON FUNCTION public.record_dose_consumption(UUID, UUID, DATE, TEXT, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) TO authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.toggle_dose_consumption(UUID, UUID, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) TO authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.delete_dose_consumption(UUID, UUID, NUMERIC) TO authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.adjust_medication_stock TO authenticated, service_role, anon;
    `;
    console.log('[Migration] Funções RPC atômicas criadas e permissões concedidas com sucesso!');
    
    // Force Supabase API cache (PostgREST) to reload and pick up the new columns immediately
    try {
      console.log('[Migration] Notificando PostgREST para recarregar o cache do schema...');
      await sql`NOTIFY pgrst, 'reload schema';`;
    } catch (notifyErr: any) {
      console.warn('[Migration] Não foi possível enviar NOTIFY pgrst (não crítico):', notifyErr.message || notifyErr);
    }

    await sql.end();
  } catch (err: any) {
    console.error('[Migration] Erro ao rodar migração de colunas:', err.message || err);
  }
}

/**
 * Scans hourly (and on startup) for accounts marked for deletion whose scheduled time has elapsed,
 * and deletes them from Auth Admin (which cascade deletes all operations data).
 */
function startScheduledDeletionWorker() {
  console.log('[Worker] Iniciando worker de exclusão de contas agendadas...');
  
  const checkAndRunDeletions = async () => {
    try {
      const now = new Date().toISOString();
      console.log(`[Worker] Verificando exclusões programadas pendentes... (Hora atual: ${now})`);
      
      let pendingDeletions: Array<{ id: string; email?: string }> = [];

      // 1. Try profiles table
      try {
        const { data: profiles, error } = await supabaseAdmin
          .from('profiles')
          .select('id, email')
          .eq('account_status', 'pending_deletion')
          .lte('scheduled_deletion_at', now);

        if (!error && profiles) {
          const typedProfiles = profiles as Array<{ id: string; email?: string }>;
          pendingDeletions = typedProfiles.map(p => ({
            id: p.id,
            email: p.email
          }));
        } else if (error) {
          console.warn('[Worker] Profiles query failed (likely missing columns):', error.message);
        }
      } catch (dbErr: any) {
        console.warn('[Worker] Profiles query threw exception:', dbErr.message || dbErr);
      }

      // 2. Auth user_metadata Backup Fallback: Scan listUsers for key values
      try {
        const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (!listErr && users) {
          for (const user of users) {
            const meta = user.user_metadata || {};
            if (meta.account_status === 'pending_deletion') {
              const scheduledAt = meta.scheduled_deletion_at;
              if (scheduledAt && scheduledAt <= now) {
                if (!pendingDeletions.some(p => p.id === user.id)) {
                  console.log(`[Worker] Falling back to user_metadata: scheduled deletion found for ${user.id}`);
                  pendingDeletions.push({ id: user.id, email: user.email });
                }
              }
            }
          }
        } else if (listErr) {
          console.error('[Worker] listUsers fallback failed:', listErr.message);
        }
      } catch (listCatch: any) {
        console.error('[Worker] listUsers fallback threw exception:', listCatch.message || listCatch);
      }
      
      if (pendingDeletions.length === 0) {
        return;
      }
      
      console.log(`[Worker] Encontradas ${pendingDeletions.length} contas para exclusão definitiva.`);
      
      for (const profile of pendingDeletions) {
        console.log(`[Worker] Excluindo permanentemente a conta do usuário ${profile.id} (${profile.email || 'sem e-mail'})`);
        
        const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(profile.id);
        if (deleteErr) {
          console.error(`[Worker] Falha ao excluir usuário ${profile.id}:`, deleteErr.message);
        } else {
          console.log(`[Worker] Usuário ${profile.id} excluído com sucesso (e todos os dados associados cascateados).`);
        }
      }
    } catch (err: any) {
      console.error('[Worker] Erro inesperado no job de exclusão:', err.message || err);
    }
  };
  
  // Run on startup
  checkAndRunDeletions();
  
  // Run every 10 minutes
  setInterval(checkAndRunDeletions, 10 * 60 * 1000);
}

async function createServer() {
  const app = express();

  // Logging middleware to help debug backend API requests
  app.use((req, res, next) => {
    if (req.url.startsWith('/api/')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
  });

  // Support JSON request parser
  app.use(express.json());

  // 1. Stripe Endpoints
  app.post('/api/stripe/checkout', (req, res) => checkoutHandler(req as any, res as any));
  app.post('/api/stripe/create-portal-session', (req, res) => portalHandler(req as any, res as any));
  app.post('/api/stripe/sync-subscription', (req, res) => syncHandler(req as any, res as any));
  app.post('/api/stripe/webhook', (req, res) => webhookHandler(req as any, res as any));

  // 2. Atomic Stock and Consumption Management API Endpoints
  app.post('/api/consumption/record', (req, res) => recordConsumptionHandler(req as any, res as any));
  app.post('/api/consumption/toggle', (req, res) => toggleConsumptionHandler(req as any, res as any));
  app.post('/api/consumption/delete', (req, res) => deleteConsumptionHandler(req as any, res as any));



  // 2. Safe and Secure Authentication-Authorized Account Deletion API Endpoint
  app.post('/api/user/delete', async (req, res): Promise<any> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nenhum token de autorização fornecido' });
    }

    const token = authHeader.split(' ')[1];

    try {
      // Authenticate via Supabase Auth
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada. Por favor, faça login novamente.' });
      }

      const userId = user.id;
      const { action } = req.body;

      if (!action) {
        return res.status(400).json({ error: 'Ação é obrigatória (delete ou cancel).' });
      }

      // Fetch user profile securely
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileErr || !profile) {
        return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
      }

      if (action === 'delete') {
        const isPremiumActive = profile.plan === 'premium' && 
          (profile.subscription_status === 'active' || profile.subscription_status === 'trial');

        if (isPremiumActive) {
          return res.status(400).json({
            error: 'Você possui uma assinatura Premium ativa. Cancele sua assinatura primeiro. Após o cancelamento da renovação automática, a exclusão da conta ficará disponível.'
          });
        }

        const isPremiumCanceled = profile.plan === 'premium' && profile.subscription_status === 'canceled';

        if (isPremiumCanceled) {
          const nowStr = new Date().toISOString();
          const scheduledDate = profile.subscription_ends_at || nowStr;

          // Mark profile as pending deletion
          const { error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update({
              account_status: 'pending_deletion',
              deletion_requested_at: nowStr,
              scheduled_deletion_at: scheduledDate,
              updated_at: nowStr
            })
            .eq('id', userId);

          if (updateErr) {
            console.error('[DeleteAPI] Erro ao agendar exclusão:', updateErr);
            return res.status(500).json({ error: 'Falha ao agendar exclusão da conta.' });
          }

          return res.status(200).json({
            status: 'scheduled',
            scheduled_deletion_at: scheduledDate,
            message: 'Sua conta foi agendada para exclusão.'
          });
        }

        // Free user (or expired subscriber): Delete immediately
        console.log(`[DeleteAPI] Usuário Free ${userId} solicitou exclusão. Excluindo conta imediatamente.`);
        const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);

        if (deleteErr) {
          console.error('[DeleteAPI] Erro ao excluir usuário:', deleteErr);
          return res.status(500).json({ error: 'Falha ao excluir a conta.' });
        }

        return res.status(200).json({
          status: 'deleted',
          message: 'Sua conta foi excluída com sucesso.'
        });

      } else if (action === 'cancel') {
        if (profile.account_status !== 'pending_deletion') {
          return res.status(400).json({ error: 'Sua conta não possui uma exclusão agendada ativa.' });
        }

        const { error: updateErr } = await supabaseAdmin
          .from('profiles')
          .update({
            account_status: 'active',
            deletion_requested_at: null,
            scheduled_deletion_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        if (updateErr) {
          console.error('[DeleteAPI] Erro ao cancelar exclusão:', updateErr);
          return res.status(500).json({ error: 'Falha ao cancelar exclusão.' });
        }

        return res.status(200).json({
          status: 'active',
          message: 'Agendamento de exclusão cancelado com sucesso.'
        });

      } else {
        return res.status(400).json({ error: 'Ação inválida.' });
      }

    } catch (err: any) {
      console.error('[DeleteAPI] Erro na API de exclusão de usuário:', err);
      return res.status(500).json({ error: 'Erro interno ao processar requisição.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

const PORT = 3000;
createServer().then(app => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Run PostgreSQL direct schema migration without blocking server startup
    runSchemaMigration().catch(err => {
      console.error('[Migration] Non-blocking schema migration error:', err);
    });
    
    // Start the background cron worker to complete scheduled deletions
    startScheduledDeletionWorker();
  });
}).catch(err => {
  console.error('[Server] Fatal error creating server:', err);
});
