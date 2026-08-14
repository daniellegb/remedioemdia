-- ============================================================================
-- MIGRATION: Etapa 4B.1 — Proteção contra p_lock_minutes NULL / <= 0 e batch_size NULL / <= 0
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_due_notification_queue(
  p_batch_size INT DEFAULT 50,
  p_lock_minutes INT DEFAULT 5
)
RETURNS SETOF public.notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_size INT;
  v_lock_minutes INT;
BEGIN
  -- Garantir valores padrão seguros (50 itens, 5 minutos de lock) se NULL ou <= 0
  v_batch_size := CASE WHEN p_batch_size IS NULL OR p_batch_size <= 0 THEN 50 ELSE p_batch_size END;
  v_lock_minutes := CASE WHEN p_lock_minutes IS NULL OR p_lock_minutes <= 0 THEN 5 ELSE p_lock_minutes END;

  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.notification_queue
    WHERE sent = false
      AND trigger_at <= NOW()
      AND (retry_at IS NULL OR retry_at <= NOW())
      AND (locked_until IS NULL OR locked_until <= NOW())
    ORDER BY trigger_at ASC
    LIMIT v_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_queue q
  SET locked_until = NOW() + (v_lock_minutes || ' minutes')::interval
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_due_notification_queue(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_notification_queue(INT, INT) TO service_role, postgres;
