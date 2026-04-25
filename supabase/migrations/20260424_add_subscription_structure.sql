
-- Migrate profiles table for subscription system
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS subscription_status TEXT CHECK (subscription_status IN ('active', 'trial', 'expired', 'canceled')) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing users to have default values if null
UPDATE public.profiles 
SET 
  subscription_status = COALESCE(subscription_status, 'active'),
  plan = COALESCE(plan, 'free'),
  updated_at = COALESCE(updated_at, NOW())
WHERE subscription_status IS NULL OR plan IS NULL OR updated_at IS NULL;

-- Ensure plan defaults to free for new records (redundant if already in table def but good for clarity)
ALTER TABLE public.profiles ALTER COLUMN plan SET DEFAULT 'free';
ALTER TABLE public.profiles ALTER COLUMN subscription_status SET DEFAULT 'active';
