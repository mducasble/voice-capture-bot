
CREATE TABLE public.campaign_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  UNIQUE(campaign_id, user_id)
);

ALTER TABLE public.campaign_participants ENABLE ROW LEVEL SECURITY;

-- Users can see their own participation
CREATE POLICY "Users can view own participation"
  ON public.campaign_participants FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can join campaigns
CREATE POLICY "Users can join campaigns"
  ON public.campaign_participants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all participants
CREATE POLICY "Admins can view all participants"
  ON public.campaign_participants FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
