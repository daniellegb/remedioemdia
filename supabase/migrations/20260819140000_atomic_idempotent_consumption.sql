-- Migration: RPC unificada, atômica e idempotente para criação de tomadas de medicação
-- Garante que a criação do registro de consumo e o débito de estoque ocorram na MESMA transação PostgreSQL (ACID)
-- Impede duplicidade de histórico e duplo débito em retries, timeouts e chamadas concorrentes

-- 1. Deduplicação preventiva de dados antigos de teste em consumption_records
DELETE FROM public.consumption_records a
USING public.consumption_records b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.medication_id = b.medication_id
  AND a.date = b.date
  AND a.scheduled_time = b.scheduled_time;

-- 2. Criar índice único de idempotência lógica (1 registro por dose/horário agendado por usuário)
CREATE UNIQUE INDEX IF NOT EXISTS idx_consumption_records_idempotency 
ON public.consumption_records (user_id, medication_id, date, scheduled_time);

-- 3. Atualizar/Criar a RPC record_dose_consumption com suporte a DATE e idempotência atômica
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
BEGIN
    -- Validar a dosagem
    v_valid_dose := CASE 
        WHEN p_dosage_amount IS NULL OR p_dosage_amount <= 0 THEN 1 
        ELSE p_dosage_amount 
    END;

    -- 1. Lock de linha no medicamento para proibir concorrência no estoque
    SELECT current_stock, next_dose_at INTO v_med_stock, v_updated_next_dose
    FROM public.medications
    WHERE id = p_medication_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Medicamento não encontrado ou não pertence ao usuário' USING ERRCODE = 'P0002';
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.record_dose_consumption TO authenticated, service_role, anon;
