-- ============================================================================
-- MIGRATION: Limpeza de Objetos e Cron Jobs Legados do Sistema de Notificações
-- ============================================================================
-- Esta migration realiza a remoção consolidada dos objetos obsoletos
-- resultantes da transição para a arquitetura unificada de notificações (Etapa 4B.1):
-- 1. RPC legada claim_due_medication_occurrences (todas as assinaturas)
-- 2. Função auxiliar legada is_contraceptive_pause_day
-- 3. Cron job legado send-reminders-every-minute (remoção idempotente)

-- 1. Remoção da RPC legada claim_due_medication_occurrences e suas sobrecargas
DROP FUNCTION IF EXISTS public.claim_due_medication_occurrences(INT, INT);
DROP FUNCTION IF EXISTS public.claim_due_medication_occurrences(INT);
DROP FUNCTION IF EXISTS public.claim_due_medication_occurrences();

-- 2. Remoção da função auxiliar legada de verificação de pausa de anticoncepcionais
DROP FUNCTION IF EXISTS public.is_contraceptive_pause_day(DATE, TEXT, DATE);

-- 3. Remoção idempotente do cron job legado send-reminders-every-minute
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_extension 
        WHERE extname = 'pg_cron'
    ) THEN
        IF EXISTS (
            SELECT 1 
            FROM cron.job 
            WHERE jobname = 'send-reminders-every-minute'
        ) THEN
            PERFORM cron.unschedule('send-reminders-every-minute');
        END IF;
    END IF;
END $$;
