-- Migration: Permitir valores decimais para current_stock e total_stock
-- Permite que dosagens fracionadas (ex: 0.5 comprimido, 1.5 ml) debitem o estoque com precisão.

ALTER TABLE public.medications
  ALTER COLUMN current_stock TYPE NUMERIC,
  ALTER COLUMN total_stock TYPE NUMERIC;
