
-- Referral reward configuration table
-- campaign_id NULL = global default; otherwise per-campaign override
CREATE TABLE public.referral_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  pool_percent numeric NOT NULL DEFAULT 10,
  cascade_keep_ratio numeric NOT NULL DEFAULT 0.60,
  max_levels integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_config ENABLE ROW LEVEL SECURITY;

-- Anyone can read referral config (needed for earnings calculations)
CREATE POLICY "Allow public read referral_config" ON public.referral_config
  FOR SELECT USING (true);

-- Only admins can manage
CREATE POLICY "Admins can insert referral_config" ON public.referral_config
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update referral_config" ON public.referral_config
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete referral_config" ON public.referral_config
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Insert global default row (campaign_id = NULL)
INSERT INTO public.referral_config (campaign_id, pool_percent, cascade_keep_ratio, max_levels)
VALUES (NULL, 10, 0.60, 5);
