-- Create topics table for dynamic topic management
CREATE TABLE public.recording_topics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description TEXT,
  emoji TEXT DEFAULT '💬',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.recording_topics ENABLE ROW LEVEL SECURITY;

-- Allow public read for topics (bot and dashboard need to read)
CREATE POLICY "Allow public read for topics" 
ON public.recording_topics 
FOR SELECT 
USING (true);

-- Add topic reference to voice_recordings
ALTER TABLE public.voice_recordings
ADD COLUMN topic_id UUID REFERENCES public.recording_topics(id),
ADD COLUMN language TEXT DEFAULT 'en';

-- Insert some initial topics
INSERT INTO public.recording_topics (name, name_en, emoji, sort_order) VALUES
('General Discussion', 'General Discussion', '💬', 1),
('Interview', 'Interview', '🎤', 2),
('Meeting', 'Meeting', '📋', 3),
('Podcast', 'Podcast', '🎙️', 4),
('Gaming Session', 'Gaming Session', '🎮', 5);

-- Add trigger for updated_at
CREATE TRIGGER update_recording_topics_updated_at
BEFORE UPDATE ON public.recording_topics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();