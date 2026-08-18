-- ============================================================================
-- MIGRATION: Etapa 4B — RPC Transacional claim_due_notification_queue
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
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.notification_queue
    WHERE sent = false
      AND trigger_at <= NOW()
      AND (retry_at IS NULL OR retry_at <= NOW())
      AND (locked_until IS NULL OR locked_until <= NOW())
    ORDER BY trigger_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_queue q
  SET locked_until = NOW() + (p_lock_minutes || ' minutes')::interval
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_due_notification_queue(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_notification_queue(INT, INT) TO service_role, postgres;
