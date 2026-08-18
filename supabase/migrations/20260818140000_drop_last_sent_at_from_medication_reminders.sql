-- ============================================================================
-- MIGRATION: 20260818140000_drop_last_sent_at_from_medication_reminders.sql
-- Remoção segura do campo legado/órfão last_sent_at da tabela medication_reminders.
-- O controle de disparo e envio é realizado via notification_queue (sent, sent_at).
-- ============================================================================

ALTER TABLE public.medication_reminders
DROP COLUMN IF EXISTS last_sent_at;
