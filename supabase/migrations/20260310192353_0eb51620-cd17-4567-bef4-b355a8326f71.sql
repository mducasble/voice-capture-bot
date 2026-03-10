
CREATE TABLE public.maintenance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz NULL,
  message text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_config ENABLE ROW LEVEL SECURITY;

-- Everyone can read (needed for the banner)
CREATE POLICY "Anyone can read maintenance_config" ON public.maintenance_config
  FOR SELECT TO public USING (true);

-- Only admins can insert/update/delete
CREATE POLICY "Admins can insert maintenance_config" ON public.maintenance_config
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update maintenance_config" ON public.maintenance_config
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete maintenance_config" ON public.maintenance_config
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Insert a single config row
INSERT INTO public.maintenance_config (id, is_active, scheduled_at, message)
VALUES ('00000000-0000-0000-0000-000000000001', false, null, null);
