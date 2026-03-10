CREATE TABLE public.carousel_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Sem título',
  format_id text NOT NULL DEFAULT 'instagram',
  slides jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.carousel_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything on carousel_projects"
ON public.carousel_projects
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));