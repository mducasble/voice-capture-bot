
-- Hardware catalog: caches hardware names and their Lucide icon names
CREATE TABLE public.hardware_catalog (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  icon_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.hardware_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read hardware_catalog" ON public.hardware_catalog FOR SELECT USING (true);
CREATE POLICY "Allow insert hardware_catalog" ON public.hardware_catalog FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update hardware_catalog" ON public.hardware_catalog FOR UPDATE USING (true);
CREATE POLICY "Allow delete hardware_catalog" ON public.hardware_catalog FOR DELETE USING (true);

-- Add required_hardware array to campaign_instructions
ALTER TABLE public.campaign_instructions ADD COLUMN required_hardware text[] DEFAULT '{}'::text[];
