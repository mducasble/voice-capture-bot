-- Tabela de clientes
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de regiões
CREATE TABLE public.regions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  country TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Adicionar campos à tabela campaigns
ALTER TABLE public.campaigns
ADD COLUMN client_id UUID REFERENCES public.clients(id),
ADD COLUMN audio_sample_rate INTEGER DEFAULT 48000,
ADD COLUMN audio_bit_depth INTEGER DEFAULT 16,
ADD COLUMN audio_channels INTEGER DEFAULT 1,
ADD COLUMN audio_format TEXT DEFAULT 'wav',
ADD COLUMN audio_min_duration_seconds NUMERIC,
ADD COLUMN audio_max_duration_seconds NUMERIC,
ADD COLUMN audio_min_snr_db NUMERIC;

-- Tabela de relação campanha-idiomas (muitos para muitos)
CREATE TABLE public.campaign_languages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  language_id UUID NOT NULL REFERENCES public.languages(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, language_id)
);

-- Tabela de relação campanha-regiões (muitos para muitos)
CREATE TABLE public.campaign_regions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  region_id UUID NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, region_id)
);

-- Seções de gravação por campanha (tópicos/prompts)
CREATE TABLE public.campaign_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  prompt_text TEXT,
  target_recordings INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Adicionar section_id às gravações
ALTER TABLE public.voice_recordings
ADD COLUMN section_id UUID REFERENCES public.campaign_sections(id);

-- Enable RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_sections ENABLE ROW LEVEL SECURITY;

-- Políticas de leitura pública
CREATE POLICY "Allow public read for clients" ON public.clients FOR SELECT USING (true);
CREATE POLICY "Allow public read for regions" ON public.regions FOR SELECT USING (true);
CREATE POLICY "Allow public read for campaign_languages" ON public.campaign_languages FOR SELECT USING (true);
CREATE POLICY "Allow public read for campaign_regions" ON public.campaign_regions FOR SELECT USING (true);
CREATE POLICY "Allow public read for campaign_sections" ON public.campaign_sections FOR SELECT USING (true);

-- Políticas de escrita (para testes sem auth)
CREATE POLICY "Allow insert for clients" ON public.clients FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update for clients" ON public.clients FOR UPDATE USING (true);
CREATE POLICY "Allow delete for clients" ON public.clients FOR DELETE USING (true);

CREATE POLICY "Allow insert for regions" ON public.regions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update for regions" ON public.regions FOR UPDATE USING (true);
CREATE POLICY "Allow delete for regions" ON public.regions FOR DELETE USING (true);

CREATE POLICY "Allow insert for campaign_languages" ON public.campaign_languages FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete for campaign_languages" ON public.campaign_languages FOR DELETE USING (true);

CREATE POLICY "Allow insert for campaign_regions" ON public.campaign_regions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete for campaign_regions" ON public.campaign_regions FOR DELETE USING (true);

CREATE POLICY "Allow insert for campaign_sections" ON public.campaign_sections FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update for campaign_sections" ON public.campaign_sections FOR UPDATE USING (true);
CREATE POLICY "Allow delete for campaign_sections" ON public.campaign_sections FOR DELETE USING (true);

-- Adicionar políticas de escrita para campaigns
CREATE POLICY "Allow insert for campaigns" ON public.campaigns FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update for campaigns" ON public.campaigns FOR UPDATE USING (true);
CREATE POLICY "Allow delete for campaigns" ON public.campaigns FOR DELETE USING (true);

-- Triggers para updated_at
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_regions_updated_at
  BEFORE UPDATE ON public.regions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_campaign_sections_updated_at
  BEFORE UPDATE ON public.campaign_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Inserir algumas regiões iniciais
INSERT INTO public.regions (name, code, country) VALUES
  ('Brasil - Sudeste', 'BR-SE', 'Brasil'),
  ('Brasil - Sul', 'BR-S', 'Brasil'),
  ('Brasil - Nordeste', 'BR-NE', 'Brasil'),
  ('Brasil - Norte', 'BR-N', 'Brasil'),
  ('Brasil - Centro-Oeste', 'BR-CO', 'Brasil'),
  ('Portugal', 'PT', 'Portugal'),
  ('Estados Unidos', 'US', 'Estados Unidos'),
  ('Reino Unido', 'UK', 'Reino Unido');