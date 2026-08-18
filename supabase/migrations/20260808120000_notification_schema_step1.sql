-- ============================================================================
-- MIGRATION: Etapa 1 — Preparação do Schema para Nova Arquitetura de Notificações
-- ============================================================================

-- 1. medication_reminders: Adicionar next_occurrence_at e índice parcial
ALTER TABLE public.medication_reminders 
ADD COLUMN IF NOT EXISTS next_occurrence_at TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS idx_medication_reminders_next_occurrence 
ON public.medication_reminders (next_occurrence_at) 
WHERE active = true;

-- 2. notification_queue: Adicionar colunas estruturais para dispatch transitório
ALTER TABLE public.notification_queue 
ADD COLUMN IF NOT EXISTS reminder_id UUID NULL REFERENCES public.medication_reminders(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS occurrence_key TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS retry_at TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS metadata JSONB NULL;

-- Adicionar constraint UNIQUE em occurrence_key se ainda não existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'notification_queue_occurrence_key_key'
    ) THEN
        ALTER TABLE public.notification_queue 
        ADD CONSTRAINT notification_queue_occurrence_key_key UNIQUE (occurrence_key);
    END IF;
END $$;

-- Índice para busca rápida por occurrence_key e reminder_id
CREATE INDEX IF NOT EXISTS idx_notification_queue_occurrence_key 
ON public.notification_queue (occurrence_key) 
WHERE occurrence_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_queue_reminder_id 
ON public.notification_queue (reminder_id) 
WHERE reminder_id IS NOT NULL;
