-- Create enum for recording status
CREATE TYPE public.recording_status AS ENUM ('uploading', 'processing', 'completed', 'failed');

-- Create table for voice recordings
CREATE TABLE public.voice_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_guild_id TEXT NOT NULL,
  discord_guild_name TEXT,
  discord_channel_id TEXT NOT NULL,
  discord_channel_name TEXT,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  filename TEXT NOT NULL,
  file_url TEXT,
  file_size_bytes BIGINT,
  duration_seconds NUMERIC,
  sample_rate INTEGER DEFAULT 44100,
  bit_depth INTEGER DEFAULT 16,
  channels INTEGER DEFAULT 2,
  format TEXT DEFAULT 'wav',
  status recording_status DEFAULT 'uploading',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX idx_recordings_guild ON public.voice_recordings(discord_guild_id);
CREATE INDEX idx_recordings_user ON public.voice_recordings(discord_user_id);
CREATE INDEX idx_recordings_created ON public.voice_recordings(created_at DESC);
CREATE INDEX idx_recordings_status ON public.voice_recordings(status);

-- Enable RLS
ALTER TABLE public.voice_recordings ENABLE ROW LEVEL SECURITY;

-- Create policy for public read (for admin dashboard - we'll add auth later)
CREATE POLICY "Allow public read for recordings"
ON public.voice_recordings
FOR SELECT
USING (true);

-- Create policy for insert via service role (edge functions)
CREATE POLICY "Allow insert via service role"
ON public.voice_recordings
FOR INSERT
WITH CHECK (true);

-- Create policy for update via service role
CREATE POLICY "Allow update via service role"
ON public.voice_recordings
FOR UPDATE
USING (true);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_voice_recordings_updated_at
BEFORE UPDATE ON public.voice_recordings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for audio files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('voice-recordings', 'voice-recordings', true);

-- Storage policies
CREATE POLICY "Allow public read for voice recordings"
ON storage.objects
FOR SELECT
USING (bucket_id = 'voice-recordings');

CREATE POLICY "Allow authenticated upload to voice recordings"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'voice-recordings');

CREATE POLICY "Allow authenticated delete from voice recordings"
ON storage.objects
FOR DELETE
USING (bucket_id = 'voice-recordings');