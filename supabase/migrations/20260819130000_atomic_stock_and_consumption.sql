-- Migration: Funções RPC atômicas para débito e estorno de estoque transacional
-- Elimina lost updates garantindo que operações de consumo e estorno sejam 100% atômicas no PostgreSQL

CREATE OR REPLACE FUNCTION public.record_dose_consumption(
    p_user_id UUID,
    p_medication_id UUID,
    p_date TEXT,
    p_scheduled_time TEXT,
    p_status TEXT,
    p_dosage_amount NUMERIC,
    p_next_dose_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_record JSONB;
    v_updated_stock NUMERIC;
    v_updated_next_dose TIMESTAMP WITH TIME ZONE;
    v_new_record_id UUID;
    v_valid_dose NUMERIC;
BEGIN
    v_valid_dose := CASE 
        WHEN p_dosage_amount IS NULL OR p_dosage_amount <= 0 THEN 1 
        ELSE p_dosage_amount 
    END;

    -- 1. Inserir registro de consumo
    INSERT INTO public.consumption_records (user_id, medication_id, date, scheduled_time, status)
    VALUES (p_user_id, p_medication_id, p_date, p_scheduled_time, p_status)
    RETURNING id INTO v_new_record_id;

    -- 2. Se status for 'taken', abater estoque atomicamente no banco
    IF p_status = 'taken' THEN
        UPDATE public.medications
        SET 
            current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) - v_valid_dose)::numeric, 4)),
            next_dose_at = COALESCE(p_next_dose_at, next_dose_at)
        WHERE id = p_medication_id AND user_id = p_user_id
        RETURNING current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose;
    ELSE
        SELECT current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose
        FROM public.medications
        WHERE id = p_medication_id AND user_id = p_user_id;
    END IF;

    SELECT to_jsonb(r) INTO v_record FROM (
        SELECT id, user_id, medication_id, date, scheduled_time, status, created_at
        FROM public.consumption_records
        WHERE id = v_new_record_id
    ) r;

    RETURN jsonb_build_object(
        'record', v_record,
        'medication_id', p_medication_id,
        'current_stock', v_updated_stock,
        'next_dose_at', v_updated_next_dose
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
    v_updated_stock NUMERIC;
    v_updated_next_dose TIMESTAMP WITH TIME ZONE;
    v_valid_dose NUMERIC;
BEGIN
    v_valid_dose := CASE 
        WHEN p_dosage_amount IS NULL OR p_dosage_amount <= 0 THEN 1 
        ELSE p_dosage_amount 
    END;

    -- 1. Obter status anterior e ID do medicamento com bloqueio de linha
    SELECT status, medication_id INTO v_old_status, v_med_id
    FROM public.consumption_records
    WHERE id = p_record_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro de consumo não encontrado' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Atualizar o registro de consumo
    UPDATE public.consumption_records
    SET status = p_new_status
    WHERE id = p_record_id AND user_id = p_user_id;

    -- 3. Ajustar estoque atomicamente no PostgreSQL
    IF v_old_status = 'taken' AND p_new_status != 'taken' THEN
        -- Estorno atômico
        UPDATE public.medications
        SET current_stock = GREATEST(0, ROUND((COALESCE(current_stock, 0) + v_valid_dose)::numeric, 4))
        WHERE id = v_med_id AND user_id = p_user_id
        RETURNING current_stock, next_dose_at INTO v_updated_stock, v_updated_next_dose;
    ELSIF v_old_status != 'taken' AND p_new_status = 'taken' THEN
        -- Débito atômico
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
        SELECT id, user_id, medication_id, date, scheduled_time, status, created_at
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_dose_consumption(
    p_user_id UUID,
    p_record_id UUID,
    p_dosage_amount NUMERIC
)
RETURNS JSONB AS $$
DECLARE
    v_old_status TEXT;
    v_med_id UUID;
    v_updated_stock NUMERIC;
    v_valid_dose NUMERIC;
BEGIN
    v_valid_dose := CASE 
        WHEN p_dosage_amount IS NULL OR p_dosage_amount <= 0 THEN 1 
        ELSE p_dosage_amount 
    END;

    SELECT status, medication_id INTO v_old_status, v_med_id
    FROM public.consumption_records
    WHERE id = p_record_id AND user_id = p_user_id
    FOR UPDATE;

    IF FOUND THEN
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
    END IF;

    RETURN jsonb_build_object('success', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.record_dose_consumption TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.toggle_dose_consumption TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.delete_dose_consumption TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.adjust_medication_stock TO authenticated, service_role, anon;
