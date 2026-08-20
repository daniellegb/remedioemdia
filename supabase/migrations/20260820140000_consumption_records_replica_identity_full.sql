-- Set REPLICA IDENTITY FULL on public.consumption_records
-- This ensures that DELETE events in WAL include all columns (specifically user_id)
-- so Supabase Realtime postgres_changes filtering by user_id works for DELETE events.

ALTER TABLE public.consumption_records REPLICA IDENTITY FULL;
