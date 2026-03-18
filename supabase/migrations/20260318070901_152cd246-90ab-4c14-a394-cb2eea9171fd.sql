-- Create payments table
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_code text NOT NULL UNIQUE,
  tx_hash text NOT NULL,
  user_id uuid NOT NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  paid_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add payment_id FK to earnings_ledger
ALTER TABLE public.earnings_ledger
  ADD COLUMN payment_id uuid REFERENCES public.payments(id);

-- Enable RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Only admins can manage payments
CREATE POLICY "Admins can manage payments"
  ON public.payments FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Users can view their own payments
CREATE POLICY "Users can view own payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to generate payment code
CREATE OR REPLACE FUNCTION public.generate_payment_code()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'pg-' || substr(md5(gen_random_uuid()::text), 1, 8);
$$;