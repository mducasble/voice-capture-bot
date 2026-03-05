
CREATE TABLE public.campaign_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, user_id)
);

ALTER TABLE public.campaign_waitlist ENABLE ROW LEVEL SECURITY;

-- Users can see their own waitlist entries
CREATE POLICY "Users can view own waitlist entries"
  ON public.campaign_waitlist FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can join waitlist
CREATE POLICY "Users can join waitlist"
  ON public.campaign_waitlist FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can leave waitlist
CREATE POLICY "Users can leave waitlist"
  ON public.campaign_waitlist FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all waitlist entries
CREATE POLICY "Admins can view all waitlist entries"
  ON public.campaign_waitlist FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
