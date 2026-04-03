
-- Adicionar colunas necessárias à tabela notification_queue (que o usuário chama de notifications)
ALTER TABLE public.notification_queue 
ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE;

-- Sincronizar scheduled_at com trigger_at para não quebrar o frontend
-- trigger_at é o que o frontend já envia
UPDATE public.notification_queue SET scheduled_at = trigger_at WHERE scheduled_at IS NULL;

-- Trigger para manter scheduled_at sincronizado com trigger_at em novos inserts/updates
CREATE OR REPLACE FUNCTION sync_scheduled_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.scheduled_at = NEW.trigger_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_scheduled_at ON public.notification_queue;
CREATE TRIGGER trg_sync_scheduled_at
BEFORE INSERT OR UPDATE OF trigger_at ON public.notification_queue
FOR EACH ROW EXECUTE FUNCTION sync_scheduled_at();

-- Garantir que a tabela tenha os índices corretos para performance
CREATE INDEX IF NOT EXISTS idx_notification_queue_scheduled_at ON public.notification_queue(scheduled_at) WHERE sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_notification_queue_sent_at ON public.notification_queue(sent_at);
