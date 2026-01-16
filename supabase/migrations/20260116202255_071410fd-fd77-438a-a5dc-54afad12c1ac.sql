-- Create languages table
CREATE TABLE public.languages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_native TEXT NOT NULL,
  emoji TEXT DEFAULT '🌐',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for languages
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;

-- Allow public read for languages
CREATE POLICY "Allow public read for languages"
ON public.languages
FOR SELECT
USING (true);

-- Create campaigns table
CREATE TABLE public.campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  target_recordings INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Allow public read for campaigns
CREATE POLICY "Allow public read for campaigns"
ON public.campaigns
FOR SELECT
USING (true);

-- Add campaign_id to voice_recordings
ALTER TABLE public.voice_recordings
ADD COLUMN campaign_id UUID REFERENCES public.campaigns(id);

-- Insert initial languages
INSERT INTO public.languages (code, name, name_native, emoji, sort_order) VALUES
  ('en', 'English', 'English', '🇺🇸', 1),
  ('pt', 'Portuguese', 'Português', '🇧🇷', 2),
  ('es', 'Spanish', 'Español', '🇪🇸', 3);

-- Insert default campaign
INSERT INTO public.campaigns (name, description, is_active) VALUES
  ('Default Campaign', 'Default voice recording campaign', true);

-- Create trigger for updated_at on languages
CREATE TRIGGER update_languages_updated_at
BEFORE UPDATE ON public.languages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger for updated_at on campaigns
CREATE TRIGGER update_campaigns_updated_at
BEFORE UPDATE ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();