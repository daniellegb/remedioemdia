-- ==========================================
-- SCRIPT DE CRIAÇÃO: active_sessions
-- Execute este script no SQL Editor do seu painel Supabase para corrigir o erro PGRST205 imediatamente!
-- ==========================================

-- 1. Criação da tabela de sessões ativas
CREATE TABLE IF NOT EXISTS public.active_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_agent TEXT,
    os TEXT,
    browser TEXT,
    device_type TEXT,
    UNIQUE(user_id, session_id)
);

-- 2. Habilitação de Segurança de Linha (RLS)
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

-- 3. Limpeza de políticas existentes (Evita erros ao reexecutar o script)
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
