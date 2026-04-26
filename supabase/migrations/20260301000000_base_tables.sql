
-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. TABELA: profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    name TEXT,
    caregiver_name TEXT,
    patient_name TEXT,
    relationship TEXT,
    onboarding_completed BOOLEAN DEFAULT FALSE,
    role TEXT DEFAULT 'user',
    plan TEXT DEFAULT 'free',
    subscription_status TEXT DEFAULT 'active',
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    subscription_ends_at TIMESTAMP WITH TIME ZONE,
    lifetime_access BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TABELA: medications
CREATE TABLE IF NOT EXISTS public.medications (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    dosage TEXT,
    unit TEXT,
    usage_category TEXT,
    doses_per_day INTEGER,
    interval_days INTEGER,
    times TEXT[],
    interval_type TEXT,
    contraceptive_type TEXT,
    start_date DATE,
    end_date DATE,
    duration_days INTEGER,
    max_doses_per_day INTEGER,
    total_stock INTEGER,
    current_stock INTEGER,
    expiry_date DATE,
    notes TEXT,
    color TEXT,
    frequency INTEGER DEFAULT 1,
    next_dose_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. TABELA: appointments
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    type TEXT,
    doctor TEXT,
    specialty TEXT,
    date DATE,
    time TEXT,
    location TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. TABELA: consumption_records
CREATE TABLE IF NOT EXISTS public.consumption_records (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    medication_id UUID REFERENCES public.medications ON DELETE CASCADE NOT NULL,
    date DATE NOT NULL,
    scheduled_time TEXT NOT NULL,
    status TEXT NOT NULL, -- 'taken', 'skipped', 'late'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. TABELA: user_preferences
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    show_greeting BOOLEAN DEFAULT TRUE,
    notifications_enabled BOOLEAN DEFAULT TRUE,
    theme TEXT DEFAULT 'light',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. SEGURANÇA (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS
CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users can manage own medications" ON public.medications FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own appointments" ON public.appointments FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own consumption" ON public.consumption_records FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own preferences" ON public.user_preferences FOR ALL USING (auth.uid() = user_id);
