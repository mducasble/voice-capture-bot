
-- Table to configure which infrastructure provider to use per job type
CREATE TABLE public.infrastructure_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type text NOT NULL UNIQUE, -- 'analyze', 'enhance', etc.
  provider text NOT NULL DEFAULT 'huggingface', -- 'local', 'huggingface', 'cloud_api'
  provider_url text, -- Base URL for the provider API
  provider_api_key text, -- Optional API key for the provider
  is_enabled boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.infrastructure_config ENABLE ROW LEVEL SECURITY;

-- Only admins can read and manage
CREATE POLICY "Admins can manage infrastructure_config"
ON public.infrastructure_config
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role full access (for edge functions)
CREATE POLICY "Service role full access infrastructure_config"
ON public.infrastructure_config
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Seed default rows
INSERT INTO public.infrastructure_config (job_type, provider, notes) VALUES
  ('analyze', 'huggingface', 'Análise de métricas de áudio (SNR, SigMOS, SRMR, etc.)'),
  ('enhance', 'huggingface', 'Melhoria de áudio (noise gate, EQ, normalização)');

-- Trigger for updated_at
CREATE TRIGGER update_infrastructure_config_updated_at
BEFORE UPDATE ON public.infrastructure_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
