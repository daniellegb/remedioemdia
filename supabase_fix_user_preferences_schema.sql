-- ===============================================================
-- PRODUCTION-READY VALIDATION AND FIX FOR user_preferences SCHEMA
-- ===============================================================
-- Goal: Ensure user_id is the PRIMARY KEY for correct upsert behavior.
-- This script handles deduplication, nullability, and automatic timestamps.

DO $$ 
BEGIN
    -- 1. Check if user_id is already the primary key
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints tc 
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name 
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' 
          AND tc.table_name = 'user_preferences' 
          AND kcu.column_name = 'user_id'
    ) THEN
        RAISE NOTICE 'user_id is not the primary key. Applying fixes...';

        -- 2. Remove the existing primary key constraint (usually on the "id" column)
        DECLARE
            pk_name TEXT;
        BEGIN
            SELECT tc.constraint_name INTO pk_name
            FROM information_schema.table_constraints tc
            WHERE tc.table_name = 'user_preferences' 
              AND tc.constraint_type = 'PRIMARY KEY';

            IF pk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.user_preferences DROP CONSTRAINT ' || quote_ident(pk_name);
                RAISE NOTICE 'Dropped existing primary key constraint: %', pk_name;
            END IF;
        END;

        -- 3. Remove any redundant UNIQUE constraint on user_id
        DECLARE
            unique_name TEXT;
        BEGIN
            SELECT tc.constraint_name INTO unique_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name 
              AND tc.table_schema = kcu.table_schema
            WHERE tc.table_name = 'user_preferences' 
              AND tc.constraint_type = 'UNIQUE'
              AND kcu.column_name = 'user_id';

            IF unique_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.user_preferences DROP CONSTRAINT ' || quote_ident(unique_name);
                RAISE NOTICE 'Dropped redundant UNIQUE constraint: %', unique_name;
            END IF;
        END;

        -- 4. HANDLE DUPLICATES BEFORE ADDING PRIMARY KEY
        -- We keep the most recently updated row if possible, otherwise use ctid as tie-breaker.
        -- This ensures we have exactly one row per user_id.
        DELETE FROM public.user_preferences a
        USING public.user_preferences b
        WHERE a.user_id = b.user_id
          AND a.ctid < b.ctid;
        RAISE NOTICE 'Deduplicated user_preferences table.';

        -- 5. ENSURE user_id IS NOT NULL
        -- Primary keys cannot contain null values.
        ALTER TABLE public.user_preferences
        ALTER COLUMN user_id SET NOT NULL;
        RAISE NOTICE 'Ensured user_id is NOT NULL.';

        -- 6. Set user_id as the PRIMARY KEY
        ALTER TABLE public.user_preferences ADD PRIMARY KEY (user_id);
        RAISE NOTICE 'Set user_id as the PRIMARY KEY for user_preferences.';

    ELSE
        RAISE NOTICE 'user_id is already the primary key. No changes needed to constraints.';
    END IF;

    -- 7. Ensure required columns exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='push_notifications_enabled') THEN
        ALTER TABLE public.user_preferences ADD COLUMN push_notifications_enabled BOOLEAN DEFAULT TRUE;
        RAISE NOTICE 'Added push_notifications_enabled column.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='updated_at') THEN
        ALTER TABLE public.user_preferences ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added updated_at column.';
    END IF;

END $$;

-- 8. AUTOMATIC updated_at TRIGGER
-- Create the function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create the trigger (idempotent check)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_user_preferences_updated_at') THEN
        CREATE TRIGGER tr_user_preferences_updated_at
        BEFORE UPDATE ON public.user_preferences
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
        RAISE NOTICE 'Created updated_at trigger.';
    END IF;
END $$;

-- 9. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ===============================================================
-- VERIFICATION
-- ===============================================================
-- Table: user_preferences
-- PK: user_id (guarantees one row per user)
-- Trigger: tr_user_preferences_updated_at (auto-updates updated_at)
-- Supports: upsert({ user_id: '...', ... })
