-- ============================================================================
-- MIGRATION: Etapa 4A — RPC Transacional claim_due_medication_occurrences
-- ============================================================================

-- 1. Adicionar coluna timezone em user_preferences se não existir
ALTER TABLE public.user_preferences 
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Sao_Paulo';

-- 2. Função auxiliar para determinar se uma data é dia de pausa de anticoncepcional
CREATE OR REPLACE FUNCTION public.is_contraceptive_pause_day(
  p_start_date DATE,
  p_contraceptive_type TEXT,
  p_check_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_diff_days INT;
  v_active_days INT;
  v_pause_days INT;
  v_cycle_total INT;
  v_day_in_cycle INT;
BEGIN
  IF p_start_date IS NULL OR p_contraceptive_type IS NULL OR p_check_date < p_start_date THEN
    RETURN FALSE;
  END IF;

  IF p_contraceptive_type = '21_7' THEN
    v_active_days := 21;
    v_pause_days := 7;
  ELSIF p_contraceptive_type = '24_4' THEN
    v_active_days := 24;
    v_pause_days := 4;
  ELSE
    RETURN FALSE;
  END IF;

  v_cycle_total := v_active_days + v_pause_days;
  v_diff_days := (p_check_date - p_start_date);
  v_day_in_cycle := (v_diff_days % v_cycle_total) + 1;

  RETURN v_day_in_cycle > v_active_days;
END;
$$;

-- 3. RPC Transacional claim_due_medication_occurrences
CREATE OR REPLACE FUNCTION public.claim_due_medication_occurrences(
  p_batch_size INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_current_occurrence_at TIMESTAMPTZ;
  v_occurrence_key TEXT;
  v_title TEXT;
  v_body TEXT;
  v_inserted_queue_id UUID;
  v_next_occurrence TIMESTAMPTZ;
  v_current_local_date DATE;
  v_next_local_date DATE;
  v_check_date DATE;
  v_cand_date DATE;
  v_diff_days INT;
  v_remainder INT;
  v_local_ts TIMESTAMP;
  v_processed_count INT := 0;
  v_created_count INT := 0;
  v_details JSONB := '[]'::jsonb;
BEGIN
  -- Iterar sobre os lembretes ativos cujo next_occurrence_at venceu (<= NOW())
  -- Usar FOR UPDATE OF mr SKIP LOCKED para garantir atomicidade e segurança em concorrência
  FOR v_rec IN
    SELECT 
      mr.id AS reminder_id,
      mr.user_id,
      mr.medication_id,
      mr.medication_name,
      mr.reminder_time,
      mr.next_occurrence_at,
      mr.message_template,
      m.dosage,
      m.unit,
      m.usage_category,
      m.interval_days,
      m.start_date,
      m.end_date,
      m.contraceptive_type,
      COALESCE(
        (
          SELECT up.timezone 
          FROM public.user_preferences up 
          WHERE up.user_id = mr.user_id 
            AND up.timezone IS NOT NULL 
            AND up.timezone != '' 
          LIMIT 1
        ),
        (
          SELECT ps.timezone 
          FROM public.push_subscriptions ps 
          WHERE ps.user_id = mr.user_id 
            AND ps.timezone IS NOT NULL 
            AND ps.timezone != '' 
          ORDER BY ps.created_at DESC 
          LIMIT 1
        ),
        'America/Sao_Paulo'
      ) AS user_tz
    FROM public.medication_reminders mr
    JOIN public.medications m ON m.id = mr.medication_id
    WHERE mr.active = true
      AND mr.next_occurrence_at IS NOT NULL
      AND mr.next_occurrence_at <= NOW()
      AND (m.usage_category IS NULL OR m.usage_category != 'prn')
      AND (m.deleted IS NOT TRUE)
    ORDER BY mr.next_occurrence_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF mr SKIP LOCKED
  LOOP
    v_processed_count := v_processed_count + 1;
    v_current_occurrence_at := v_rec.next_occurrence_at;
    
    -- Chave determinística da ocorrência: <reminder_id>:<ISO8601_UTC_scheduled_at>
    v_occurrence_key := v_rec.reminder_id || ':' || to_char(v_current_occurrence_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    v_title := 'Hora do Medicamento 💊';
    v_body := COALESCE(
      v_rec.message_template,
      'Tomar ' || v_rec.medication_name || CASE WHEN v_rec.dosage IS NOT NULL AND v_rec.dosage != '' THEN ' (' || v_rec.dosage || ')' ELSE '' END
    );

    v_inserted_queue_id := NULL;

    -- Inserir na notification_queue de forma idempotente usando ON CONFLICT (occurrence_key) DO NOTHING
    INSERT INTO public.notification_queue (
      user_id,
      reminder_id,
      medication_id,
      title,
      body,
      scheduled_at,
      trigger_at,
      sent,
      retry_count,
      occurrence_key,
      metadata,
      created_at
    ) VALUES (
      v_rec.user_id,
      v_rec.reminder_id,
      v_rec.medication_id,
      v_title,
      v_body,
      v_current_occurrence_at,
      v_current_occurrence_at,
      false,
      0,
      v_occurrence_key,
      jsonb_build_object(
        'reminder_id', v_rec.reminder_id,
        'medication_id', v_rec.medication_id,
        'reminder_time', v_rec.reminder_time,
        'timezone', v_rec.user_tz
      ),
      NOW()
    )
    ON CONFLICT (occurrence_key) DO NOTHING
    RETURNING id INTO v_inserted_queue_id;

    IF v_inserted_queue_id IS NOT NULL THEN
      v_created_count := v_created_count + 1;
    END IF;

    -- Data local da ocorrência atual no fuso do usuário
    v_current_local_date := (v_current_occurrence_at AT TIME ZONE v_rec.user_tz)::date;
    v_next_local_date := NULL;

    -- Cálculo da próxima data local válida
    IF v_rec.usage_category = 'contraceptive' THEN
      v_check_date := v_current_local_date + 1;
      FOR i IN 0..60 LOOP
        IF NOT public.is_contraceptive_pause_day(v_rec.start_date, v_rec.contraceptive_type, v_check_date) THEN
          IF v_rec.start_date IS NULL OR v_check_date >= v_rec.start_date THEN
            v_next_local_date := v_check_date;
            EXIT;
          END IF;
        END IF;
        v_check_date := v_check_date + 1;
      END LOOP;
    ELSIF v_rec.usage_category = 'continuous' AND v_rec.interval_days IS NOT NULL AND v_rec.interval_days > 1 AND v_rec.start_date IS NOT NULL THEN
      v_cand_date := v_current_local_date + 1;
      v_diff_days := v_cand_date - v_rec.start_date;
      IF v_diff_days < 0 THEN
        v_next_local_date := v_rec.start_date;
      ELSE
        v_remainder := v_diff_days % v_rec.interval_days;
        IF v_remainder != 0 THEN
          v_next_local_date := v_cand_date + (v_rec.interval_days - v_remainder);
        ELSE
          v_next_local_date := v_cand_date;
        END IF;
      END IF;
    ELSE
      v_next_local_date := v_current_local_date + 1;
      IF v_rec.start_date IS NOT NULL AND v_next_local_date < v_rec.start_date THEN
        v_next_local_date := v_rec.start_date;
      END IF;
    END IF;

    -- Verificar end_date
    IF v_next_local_date IS NULL OR (v_rec.end_date IS NOT NULL AND v_next_local_date > v_rec.end_date) THEN
      v_next_occurrence := NULL;
    ELSE
      BEGIN
        v_local_ts := v_next_local_date + v_rec.reminder_time::time;
        v_next_occurrence := v_local_ts AT TIME ZONE v_rec.user_tz;
      EXCEPTION WHEN OTHERS THEN
        v_next_occurrence := NULL;
      END;
    END IF;

    -- Atualizar o medication_reminder com a próxima ocorrência
    UPDATE public.medication_reminders
    SET 
      next_occurrence_at = v_next_occurrence
    WHERE id = v_rec.reminder_id;

    v_details := v_details || jsonb_build_object(
      'reminder_id', v_rec.reminder_id,
      'occurrence_key', v_occurrence_key,
      'claimed_at', v_current_occurrence_at,
      'next_occurrence_at', v_next_occurrence,
      'queue_id', v_inserted_queue_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed_count,
    'created', v_created_count,
    'details', v_details
  );
END;
$$;

-- Restringir permissões de execução: Apenas service_role e postgres
REVOKE EXECUTE ON FUNCTION public.claim_due_medication_occurrences(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_medication_occurrences(INT) TO service_role, postgres;
