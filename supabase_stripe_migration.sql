-- Audit table for Stripe events
create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  stripe_event_type text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_session_id text,
  user_id uuid references auth.users(id),
  payload_json jsonb not null,
  processed_at timestamp with time zone default now()
);

-- Ensure profiles has stripe columns
alter table public.profiles 
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists subscription_status text,
add column if not exists plan text default 'free';

-- Enable RLS for stripe_events (optional, but good practice)
alter table public.stripe_events enable row level security;

-- Only admins should see stripe events (using service_role via our admin client)
create policy "Admins can view stripe events"
on public.stripe_events
for select
using ( auth.jwt() ->> 'role' = 'service_role' );
