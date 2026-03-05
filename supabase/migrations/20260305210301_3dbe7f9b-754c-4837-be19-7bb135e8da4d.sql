
-- Add referral_code to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

-- Generate referral codes for existing profiles
UPDATE public.profiles SET referral_code = substr(md5(id::text || random()::text), 1, 8) WHERE referral_code IS NULL;

-- Create referrals table
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  referred_by uuid NOT NULL,
  level_1 uuid,
  level_2 uuid,
  level_3 uuid,
  level_4 uuid,
  level_5 uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Users can view own referral record
CREATE POLICY "Users can view own referral" ON public.referrals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Users can see who they referred (where they appear in any level)
CREATE POLICY "Users can see referrals in their network" ON public.referrals
  FOR SELECT TO authenticated USING (
    auth.uid() = referred_by OR
    auth.uid() = level_1 OR
    auth.uid() = level_2 OR
    auth.uid() = level_3 OR
    auth.uid() = level_4 OR
    auth.uid() = level_5
  );

-- Authenticated users can insert their own referral
CREATE POLICY "Users can insert own referral" ON public.referrals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Update handle_new_user to generate referral_code
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, referral_code)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), substr(md5(NEW.id::text || random()::text), 1, 8));
  RETURN NEW;
END;
$$;
