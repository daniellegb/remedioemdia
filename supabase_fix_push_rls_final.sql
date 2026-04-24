
-- ===============================================================
-- FIX PUSH NOTIFICATIONS RLS AND STRUCTURE
-- ===============================================================

-- 1. Ensure extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Repair table structure (ensure all columns exist)
DO $$ 
BEGIN
    -- Ensure table exists with base columns
    CREATE TABLE IF NOT EXISTS public.push_subscriptions (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
        endpoint TEXT NOT NULL,
        subscription JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Add additional columns if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='push_subscriptions' AND column_name='p256dh') THEN
        ALTER TABLE public.push_subscriptions ADD COLUMN p256dh TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='push_subscriptions' AND column_name='auth') THEN
        ALTER TABLE public.push_subscriptions ADD COLUMN auth TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='push_subscriptions' AND column_name='timezone') THEN
        ALTER TABLE public.push_subscriptions ADD COLUMN timezone TEXT DEFAULT 'UTC';
    END IF;

    -- 3. Correct Uniqueness: should be only on endpoint to support device-based uniqueness
    -- Drop old constraints
    ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_subscription_key;
    ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;
    ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;
    
    -- Ensure endpoint is unique (This is required for 'onConflict: endpoint' upserts)
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);

    -- 4. Reset RLS
    ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

    -- 5. Robust RLS Policies
    DROP POLICY IF EXISTS "Users can manage own push subs" ON public.push_subscriptions;
    DROP POLICY IF EXISTS "Users can manage own subscriptions" ON public.push_subscriptions;
    DROP POLICY IF EXISTS "Allow individual management" ON public.push_subscriptions;

    -- Policy for SELECT: Users can only see their own subscriptions
    CREATE POLICY "Allow select own" ON public.push_subscriptions
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

    -- Policy for INSERT: Users can insert as themselves
    CREATE POLICY "Allow insert own" ON public.push_subscriptions
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

    -- Policy for DELETE: Users can delete their own
    CREATE POLICY "Allow delete own" ON public.push_subscriptions
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

    -- Policy for UPDATE: This is the tricky one for upserts
    -- We allow update if it's currently yours, OR we allow "takeover" if the endpoint matches 
    -- but only if you are setting the user_id to yourself.
    -- Supabase RLS using(true) on update allows the engine to find the row by endpoint, 
    -- then with check(auth.uid() = user_id) ensures the final state is owned by the current user.
    CREATE POLICY "Allow update/takeover" ON public.push_subscriptions
    FOR UPDATE TO authenticated 
    USING (true) 
    WITH CHECK (auth.uid() = user_id); -- Ensure final user_id matches the authenticated user

    RAISE NOTICE 'Push RLS and structure fixed.';
END $$;

-- Recarregar cache do PostgREST
NOTIFY pgrst, 'reload schema';
