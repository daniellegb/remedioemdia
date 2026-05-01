-- Add has_used_trial column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_used_trial BOOLEAN DEFAULT FALSE;
