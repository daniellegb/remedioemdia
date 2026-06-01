-- Migration to restrict stripe_subscription_history RLS policies
-- Removing public/authenticated user select access, leaving only service_role access

DROP POLICY IF EXISTS "Users can view their own subscription history" ON public.stripe_subscription_history;

-- Ensure Row Level Security remains enabled
ALTER TABLE public.stripe_subscription_history ENABLE ROW LEVEL SECURITY;
