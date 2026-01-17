-- Add separate field for ElevenLabs transcription
ALTER TABLE public.voice_recordings 
ADD COLUMN IF NOT EXISTS transcription_elevenlabs TEXT,
ADD COLUMN IF NOT EXISTS transcription_elevenlabs_status TEXT DEFAULT 'pending';