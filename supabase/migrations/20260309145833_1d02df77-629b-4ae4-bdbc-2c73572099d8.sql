
CREATE TABLE public.faq_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL DEFAULT 'general',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  question_pt text NOT NULL,
  question_en text,
  question_es text,
  answer_pt text NOT NULL,
  answer_en text,
  answer_es text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.faq_items ENABLE ROW LEVEL SECURITY;

-- Everyone can read active FAQs
CREATE POLICY "Allow public read faq_items" ON public.faq_items
  FOR SELECT TO public USING (true);

-- Only admins can insert
CREATE POLICY "Admins can insert faq_items" ON public.faq_items
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));

-- Only admins can update
CREATE POLICY "Admins can update faq_items" ON public.faq_items
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Only admins can delete
CREATE POLICY "Admins can delete faq_items" ON public.faq_items
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
