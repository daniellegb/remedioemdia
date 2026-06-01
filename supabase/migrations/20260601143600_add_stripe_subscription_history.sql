-- Migration for Stripe Subscription History
CREATE TABLE IF NOT EXISTS public.stripe_subscription_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE,
  canceled_at TIMESTAMP WITH TIME ZONE,
  access_expires_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL CHECK (status IN ('active', 'canceling', 'ended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.stripe_subscription_history ENABLE ROW LEVEL SECURITY;

-- Select policy: User has read access to their own history
CREATE POLICY "Users can view their own subscription history"
ON public.stripe_subscription_history
FOR SELECT
USING (auth.uid() = user_id);

-- Admin policy: Service role can do everything
CREATE POLICY "Admins can manage subscription history"
ON public.stripe_subscription_history
FOR ALL
USING (auth.jwt() ->> 'role' = 'service_role');
