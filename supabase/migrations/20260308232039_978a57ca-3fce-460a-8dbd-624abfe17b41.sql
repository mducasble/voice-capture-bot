
CREATE TABLE public.instruction_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  instructions_title text,
  instructions_summary text,
  instructions_steps jsonb DEFAULT '[]'::jsonb,
  prompt_do text[] DEFAULT '{}'::text[],
  prompt_dont text[] DEFAULT '{}'::text[],
  required_hardware text[] DEFAULT '{}'::text[],
  video_url text,
  pdf_file_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.instruction_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read instruction_templates" ON public.instruction_templates FOR SELECT USING (true);
CREATE POLICY "Admin insert instruction_templates" ON public.instruction_templates FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update instruction_templates" ON public.instruction_templates FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin delete instruction_templates" ON public.instruction_templates FOR DELETE USING (public.has_role(auth.uid(), 'admin'));
