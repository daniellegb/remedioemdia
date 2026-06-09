-- Migration to create public.active_sessions for remote session management representation
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

-- Enable Row Level Security
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

-- Drop policies to recreate them cleanly (idempotent)
DROP POLICY IF EXISTS "Users can view their own active sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can insert their own active sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can update their own active sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can delete their own active sessions" ON public.active_sessions;

-- Create security policies
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
