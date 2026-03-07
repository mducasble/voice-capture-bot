
CREATE TABLE public.prompt_rules_catalog (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_text TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'dont',
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.prompt_rules_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read prompt_rules_catalog" ON public.prompt_rules_catalog FOR SELECT USING (true);
CREATE POLICY "Allow insert prompt_rules_catalog" ON public.prompt_rules_catalog FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update prompt_rules_catalog" ON public.prompt_rules_catalog FOR UPDATE USING (true);
CREATE POLICY "Allow delete prompt_rules_catalog" ON public.prompt_rules_catalog FOR DELETE USING (true);
