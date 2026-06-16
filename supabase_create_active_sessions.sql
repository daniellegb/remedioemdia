-- ==========================================
-- SCRIPT DE CRIAÇÃO: active_sessions
-- Execute este script no SQL Editor do seu painel Supabase para corrigir o erro PGRST205 imediatamente!
-- ==========================================

-- 1. Remoção segura para recriação do esquema
DROP TABLE IF EXISTS public.active_sessions CASCADE;

-- 1. Criação da tabela de sessões ativas
CREATE TABLE public.active_sessions (
    session_id TEXT PRIMARY KEY,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_agent TEXT,
    os TEXT,
    browser TEXT,
    device_type TEXT
);

-- 2. Habilitação de Segurança de Linha (RLS) e Réplica para Realtime
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions REPLICA IDENTITY FULL;

-- 3. Inserir na publicação de Realtime do Supabase, se existir
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.active_sessions;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Tabela active_sessions já está na publicação ou ocorreu outro erro.';
    END;
  END IF;
END $$;

-- 4. Limpeza de políticas existentes (Evita erros ao reexecutar o script)
DROP POLICY IF EXISTS "Users can view their own active sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can insert their own active sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can update their own active sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can delete their own active sessions" ON public.active_sessions;

-- 4. Criação das políticas de segurança RLS (Garante privacidade dos dados dos usuários)
CREATE POLICY "Users can view their own active sessions" 
ON public.active_sessions FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own active sessions" 
ON public.active_sessions FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own active sessions" 
ON public.active_sessions FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own active sessions" 
ON public.active_sessions FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);

-- 5. Forçar atualização do cache do esquema do PostgREST
NOTIFY pgrst, 'reload schema';
