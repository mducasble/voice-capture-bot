-- Add transcription column to voice_recordings table
ALTER TABLE public.voice_recordings 
ADD COLUMN transcription TEXT NULL;

-- Add transcription_status column to track transcription progress
ALTER TABLE public.voice_recordings 
ADD COLUMN transcription_status TEXT NULL DEFAULT 'pending';

COMMENT ON COLUMN public.voice_recordings.transcription IS 'AI-generated transcription of the audio recording';
COMMENT ON COLUMN public.voice_recordings.transcription_status IS 'Status of transcription: pending, processing, completed, failed';