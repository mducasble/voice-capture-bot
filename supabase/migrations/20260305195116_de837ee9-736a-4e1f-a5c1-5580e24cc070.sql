
-- Add 'vendor' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vendor';

-- Create vendor_applications table for admin approval workflow
CREATE TABLE public.vendor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  company_name text,
  notes text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_applications ENABLE ROW LEVEL SECURITY;

-- Users can view their own application
CREATE POLICY "Users can view own vendor application"
  ON public.vendor_applications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own application
CREATE POLICY "Users can create vendor application"
  ON public.vendor_applications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all applications
CREATE POLICY "Admins can view all vendor applications"
  ON public.vendor_applications FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admins can update applications (approve/reject)
CREATE POLICY "Admins can update vendor applications"
  ON public.vendor_applications FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_vendor_applications_updated_at
  BEFORE UPDATE ON public.vendor_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
