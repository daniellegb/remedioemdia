-- 1. Garantir que a tabela e as colunas existem
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  threshold_expiring INTEGER DEFAULT 3,
  threshold_running_out INTEGER DEFAULT 3,
  show_delay_disclaimer BOOLEAN DEFAULT TRUE,
  show_greeting BOOLEAN DEFAULT TRUE,
  pre_notification_minutes INTEGER DEFAULT 5,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 2. Adicionar colunas caso a tabela já existisse sem elas
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='threshold_expiring') THEN
    ALTER TABLE public.user_preferences ADD COLUMN threshold_expiring INTEGER DEFAULT 3;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='threshold_running_out') THEN
    ALTER TABLE public.user_preferences ADD COLUMN threshold_running_out INTEGER DEFAULT 3;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='show_delay_disclaimer') THEN
    ALTER TABLE public.user_preferences ADD COLUMN show_delay_disclaimer BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='show_greeting') THEN
    ALTER TABLE public.user_preferences ADD COLUMN show_greeting BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='pre_notification_minutes') THEN
    ALTER TABLE public.user_preferences ADD COLUMN pre_notification_minutes INTEGER DEFAULT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='push_notifications_enabled') THEN
    ALTER TABLE public.user_preferences ADD COLUMN push_notifications_enabled BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='updated_at') THEN
    ALTER TABLE public.user_preferences ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
END $$;

-- 3. Habilitar RLS e Políticas
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own preferences" ON public.user_preferences;
CREATE POLICY "Users can manage own preferences" ON public.user_preferences 
FOR ALL USING (auth.uid() = user_id);

-- 4. Corrigir Realtime: Apenas adicionar a tabela à publicação existente
-- Se a publicação não existir, cria; se existir, adiciona a tabela
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE medications, consumption_records, appointments, profiles, user_preferences;
  ELSE
    -- Tenta adicionar a tabela. Se já estiver lá, o PostgreSQL ignora ou você trata o erro.
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE user_preferences;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Tabela user_preferences já está na publicação ou erro ao adicionar.';
    END;
  END IF;
END $$;

-- 5. FORÇAR RELOAD DO SCHEMA CACHE (Resolve PGRST204)
NOTIFY pgrst, 'reload schema';
