-- Migration Etapa 3: Segurança Reforçada das RPCs de Consumo (Identity Alignment, Ownership & Execution Grants)
-- Garante que RPCs validem auth.uid() = p_user_id e a propriedade do recurso (medication/record)
-- Revoga privilégios de execução de clientes anônimos e do público

-- 1. Redefinir public.record_dose_consumption
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


-- 2. Redefinir public.toggle_dose_consumption
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


-- 3. Redefinir public.delete_dose_consumption
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


-- 4. Ajustar Privilégios de Execução (GRANTs/REVOKEs)
-- Revogar explicitamente permissão de execução de anon e PUBLIC
REVOKE EXECUTE ON FUNCTION public.record_dose_consumption(UUID, UUID, DATE, TEXT, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.toggle_dose_consumption(UUID, UUID, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_dose_consumption(UUID, UUID, NUMERIC) FROM PUBLIC, anon;

-- Conceder permissão de execução apenas para usuários autenticados e service_role
GRANT EXECUTE ON FUNCTION public.record_dose_consumption(UUID, UUID, DATE, TEXT, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_dose_consumption(UUID, UUID, TEXT, NUMERIC, TIMESTAMP WITH TIME ZONE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_dose_consumption(UUID, UUID, NUMERIC) TO authenticated, service_role;
