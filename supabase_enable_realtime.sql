-- 1. Create user_preferences table if it doesn't exist with all fields
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

-- 2. Add columns if they are missing (in case table already existed)
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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='updated_at') THEN
    ALTER TABLE public.user_preferences ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
END $$;

-- 3. Enable RLS for user_preferences
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for user_preferences
DROP POLICY IF EXISTS "Users can manage own preferences" ON public.user_preferences;
CREATE POLICY "Users can manage own preferences" ON public.user_preferences 
FOR ALL USING (auth.uid() = user_id);

-- 5. Enable Realtime for all relevant tables
-- First, drop if exists to avoid errors if already there
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE 
  medications, 
  consumption_records, 
  appointments, 
  profiles, 
  user_preferences;
