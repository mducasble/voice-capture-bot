-- Add column for compressed MP3 URL
ALTER TABLE public.voice_recordings 
ADD COLUMN IF NOT EXISTS mp3_file_url TEXT;

-- Add comment explaining the purpose
COMMENT ON COLUMN public.voice_recordings.mp3_file_url IS 'URL of the compressed MP3 version used for analysis and transcription';