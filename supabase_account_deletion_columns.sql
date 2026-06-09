-- SCRIPT DE MIGRAÇÃO: ADICIONAR COLUNAS DE EXCLUSÃO DE CONTA
-- Execute este script no editor SQL do seu painel Supabase para habilitar colunas nativas no banco de dados.

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active' CHECK (account_status IN ('active', 'pending_deletion')),
ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMP WITH TIME ZONE;
