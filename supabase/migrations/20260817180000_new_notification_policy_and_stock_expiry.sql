-- ============================================================================
-- MIGRATION: 20260817180000_new_notification_policy_and_stock_expiry.sql
-- Nova política de notificações do Remédio em Dia:
-- 1. Administração: "Passamos por um horário de administração. Confira seus remédios no Painel Hoje."
-- 2. Próximo da Validade: "Remédio próximo da data de validade. Verifique no Painel Hoje."
-- 3. Medicamento Vencido: "Remédio vencido. Verifique no Painel Hoje."
-- 4. Próximo de Acabar: "Remédio próximo de acabar. Verifique no Painel Hoje."
-- 5. Sem Estoque: "Remédio sem estoque. Verifique no Painel Hoje."
-- ============================================================================

-- 1. Atualizar a RPC claim_due_medication_occurrences para a nova política de conteúdo
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
    
    -- Chave de idempotência unívoca por ocorrência
    v_occurrence_key := v_rec.reminder_id || ':' || to_char(v_current_occurrence_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    -- Nova política: texto fixo sem nome de remédio ou horário
    v_title := 'Remédio em Dia';
    v_body := 'Passamos por um horário de administração. Confira seus remédios no Painel Hoje.';

    v_inserted_queue_id := NULL;

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
        'type', 'medication_administration',
        'reminder_id', v_rec.reminder_id,
        'medication_id', v_rec.medication_id,
        'reminder_time', v_rec.reminder_time,
        'timezone', v_rec.user_tz,
        'url', '/historico'
      ),
      NOW()
    )
    ON CONFLICT (occurrence_key) DO NOTHING
    RETURNING id INTO v_inserted_queue_id;

    IF v_inserted_queue_id IS NOT NULL THEN
      v_created_count := v_created_count + 1;
    END IF;

    -- Calcular a próxima ocorrência
    v_current_local_date := (v_current_occurrence_at AT TIME ZONE v_rec.user_tz)::date;
    v_next_local_date := NULL;

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

    UPDATE public.medication_reminders
    SET next_occurrence_at = v_next_occurrence
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

-- 2. Criar RPC claim_due_stock_and_expiry_occurrences para notificações de validade e estoque
CREATE OR REPLACE FUNCTION public.claim_due_stock_and_expiry_occurrences(
  p_batch_size INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_current_local_date DATE;
  v_occurrence_key TEXT;
  v_title TEXT := 'Remédio em Dia';
  v_body TEXT;
  v_type TEXT;
  v_created_count INT := 0;
  v_processed_count INT := 0;
  v_doses_per_day NUMERIC;
  v_days_left INT;
BEGIN
  FOR v_rec IN
    SELECT 
      m.id AS medication_id,
      m.user_id,
      m.name AS medication_name,
      m.usage_category,
      m.times,
      m.interval_days,
      m.current_stock,
      m.total_stock,
      m.expiry_date,
      COALESCE(up.threshold_expiring, 3) AS threshold_expiring,
      COALESCE(up.threshold_running_out, 3) AS threshold_running_out,
      COALESCE(up.timezone, 'America/Sao_Paulo') AS user_tz
    FROM public.medications m
    LEFT JOIN public.user_preferences up ON up.user_id = m.user_id
    WHERE m.active = true
      AND (m.deleted IS NOT TRUE)
    LIMIT p_batch_size
  LOOP
    v_processed_count := v_processed_count + 1;
    v_current_local_date := (NOW() AT TIME ZONE v_rec.user_tz)::date;

    -- A. Regra de Medicamento Vencido (dia em que atinge ou ultrapassa a data de validade)
    IF v_rec.expiry_date IS NOT NULL AND v_current_local_date >= v_rec.expiry_date THEN
      v_occurrence_key := 'expired:' || v_rec.medication_id || ':' || v_rec.expiry_date::text;
      v_body := 'Remédio vencido. Verifique no Painel Hoje.';
      v_type := 'medication_expired';

      INSERT INTO public.notification_queue (
        user_id,
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
        v_rec.medication_id,
        v_title,
        v_body,
        NOW(),
        NOW(),
        false,
        0,
        v_occurrence_key,
        jsonb_build_object(
          'type', v_type,
          'medication_id', v_rec.medication_id,
          'expiry_date', v_rec.expiry_date,
          'url', '/historico'
        ),
        NOW()
      )
      ON CONFLICT (occurrence_key) DO NOTHING;

      IF FOUND THEN
        v_created_count := v_created_count + 1;
      END IF;

    -- B. Regra de Medicamento Próximo da Validade (no dia configurado pelo usuário para o aviso)
    ELSIF v_rec.expiry_date IS NOT NULL AND v_current_local_date = (v_rec.expiry_date - v_rec.threshold_expiring) THEN
      v_occurrence_key := 'expiry_warning:' || v_rec.medication_id || ':' || v_rec.expiry_date::text;
      v_body := 'Remédio próximo da data de validade. Verifique no Painel Hoje.';
      v_type := 'medication_expiring_soon';

      INSERT INTO public.notification_queue (
        user_id,
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
        v_rec.medication_id,
        v_title,
        v_body,
        NOW(),
        NOW(),
        false,
        0,
        v_occurrence_key,
        jsonb_build_object(
          'type', v_type,
          'medication_id', v_rec.medication_id,
          'expiry_date', v_rec.expiry_date,
          'url', '/historico'
        ),
        NOW()
      )
      ON CONFLICT (occurrence_key) DO NOTHING;

      IF FOUND THEN
        v_created_count := v_created_count + 1;
      END IF;
    END IF;

    -- C. Regra de Medicamento Sem Estoque (quando o estoque chega a zero)
    IF v_rec.current_stock IS NOT NULL AND v_rec.current_stock <= 0 AND (v_rec.total_stock > 0 OR v_rec.usage_category != 'prn') THEN
      v_occurrence_key := 'stock_empty:' || v_rec.medication_id || ':' || v_current_local_date::text;
      v_body := 'Remédio sem estoque. Verifique no Painel Hoje.';
      v_type := 'medication_out_of_stock';

      INSERT INTO public.notification_queue (
        user_id,
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
        v_rec.medication_id,
        v_title,
        v_body,
        NOW(),
        NOW(),
        false,
        0,
        v_occurrence_key,
        jsonb_build_object(
          'type', v_type,
          'medication_id', v_rec.medication_id,
          'url', '/historico'
        ),
        NOW()
      )
      ON CONFLICT (occurrence_key) DO NOTHING;

      IF FOUND THEN
        v_created_count := v_created_count + 1;
      END IF;

    -- D. Regra de Medicamento Próximo de Acabar (quando chega ao dia/limite configurado de estoque)
    ELSIF v_rec.current_stock IS NOT NULL AND v_rec.current_stock > 0 THEN
      -- Cálculo de doses por dia
      IF v_rec.usage_category IN ('continuous', 'period') THEN
        v_doses_per_day := GREATEST(COALESCE(cardinality(v_rec.times), 1), 1)::numeric / GREATEST(COALESCE(v_rec.interval_days, 1), 1)::numeric;
      ELSIF v_rec.usage_category = 'intervals' THEN
        v_doses_per_day := 1.0 / GREATEST(COALESCE(v_rec.interval_days, 1), 1)::numeric;
      ELSIF v_rec.usage_category = 'contraceptive' THEN
        v_doses_per_day := 1.0;
      ELSE
        v_doses_per_day := 0.0;
      END IF;

      IF v_doses_per_day > 0 THEN
        v_days_left := floor(v_rec.current_stock::numeric / v_doses_per_day)::int;
        IF v_days_left <= v_rec.threshold_running_out THEN
          v_occurrence_key := 'stock_warning:' || v_rec.medication_id || ':' || v_current_local_date::text;
          v_body := 'Remédio próximo de acabar. Verifique no Painel Hoje.';
          v_type := 'medication_stock_running_out';

          INSERT INTO public.notification_queue (
            user_id,
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
            v_rec.medication_id,
            v_title,
            v_body,
            NOW(),
            NOW(),
            false,
            0,
            v_occurrence_key,
            jsonb_build_object(
              'type', v_type,
              'medication_id', v_rec.medication_id,
              'days_left', v_days_left,
              'url', '/historico'
            ),
            NOW()
          )
          ON CONFLICT (occurrence_key) DO NOTHING;

          IF FOUND THEN
            v_created_count := v_created_count + 1;
          END IF;
        END IF;
      END IF;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed_count,
    'created', v_created_count
  );
END;
$$;

-- Permissões
REVOKE EXECUTE ON FUNCTION public.claim_due_medication_occurrences(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_medication_occurrences(INT) TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.claim_due_stock_and_expiry_occurrences(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_stock_and_expiry_occurrences(INT) TO service_role, postgres;
