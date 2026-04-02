-- ===============================================================
-- FIX PUSH NOTIFICATIONS FOR MULTI-DEVICE SUPPORT
-- ===============================================================
-- Goal: Allow multiple devices per user by making endpoint UNIQUE.
-- Ensures each device has its own independent subscription.

DO $$ 
BEGIN
    -- 1. Garantir que a tabela push_subscriptions tenha a estrutura correta
    CREATE TABLE IF NOT EXISTS public.push_subscriptions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh TEXT,
        auth TEXT,
        subscription JSONB,
        timezone TEXT DEFAULT 'UTC',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- 2. Adicionar colunas caso a tabela já existisse sem elas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='push_subscriptions' AND column_name='p256dh') THEN
        ALTER TABLE public.push_subscriptions ADD COLUMN p256dh TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='push_subscriptions' AND column_name='auth') THEN
        ALTER TABLE public.push_subscriptions ADD COLUMN auth TEXT;
    END IF;

    -- 3. Migrar dados do JSONB para as novas colunas se necessário
    UPDATE public.push_subscriptions 
    SET 
        p256dh = subscription->'keys'->>'p256dh',
        auth = subscription->'keys'->>'auth'
    WHERE p256dh IS NULL OR auth IS NULL;

    -- 4. Corrigir as restrições de unicidade
    -- Removemos restrições antigas baseadas em user_id + endpoint
    ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;
    ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

    -- Removemos duplicatas de endpoint se existirem (mantendo a mais recente)
    DELETE FROM public.push_subscriptions a
    USING public.push_subscriptions b
    WHERE a.endpoint = b.endpoint
      AND a.created_at < b.created_at;

    -- Adicionamos a restrição UNIQUE apenas no endpoint (Requisito Obrigatório)
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);

    -- 5. Habilitar RLS
    ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

    -- 6. Políticas de RLS
    DROP POLICY IF EXISTS "Users can manage own subscriptions" ON public.push_subscriptions;
    DROP POLICY IF EXISTS "Users can manage own push subs" ON public.push_subscriptions;
    
    CREATE POLICY "Users can manage own subscriptions" ON public.push_subscriptions 
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

    -- 7. Índice para performance
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

    RAISE NOTICE 'Push subscriptions table updated for multi-device support.';
END $$;

-- Recarregar cache do PostgREST
NOTIFY pgrst, 'reload schema';
