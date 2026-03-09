CREATE TABLE public.short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  target_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read short_links"
  ON public.short_links FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create short_links"
  ON public.short_links FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);
