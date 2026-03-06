
CREATE TABLE public.campaign_instructions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instructions_title text DEFAULT NULL,
  instructions_summary text DEFAULT NULL,
  prompt_do text[] DEFAULT '{}'::text[],
  prompt_dont text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

ALTER TABLE public.campaign_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read campaign_instructions" ON public.campaign_instructions FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_instructions" ON public.campaign_instructions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update campaign_instructions" ON public.campaign_instructions FOR UPDATE USING (true);
CREATE POLICY "Allow delete campaign_instructions" ON public.campaign_instructions FOR DELETE USING (true);
