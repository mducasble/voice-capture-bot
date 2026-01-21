-- Add session tracking and recording type to voice_recordings
ALTER TABLE public.voice_recordings 
ADD COLUMN IF NOT EXISTS session_id uuid DEFAULT NULL,
ADD COLUMN IF NOT EXISTS recording_type text DEFAULT 'mixed' CHECK (recording_type IN ('individual', 'mixed'));

-- Add index for session queries
CREATE INDEX IF NOT EXISTS idx_voice_recordings_session_id ON public.voice_recordings(session_id);

-- Add comment for clarity
COMMENT ON COLUMN public.voice_recordings.session_id IS 'Groups individual and mixed recordings from the same session';
COMMENT ON COLUMN public.voice_recordings.recording_type IS 'individual = single user, mixed = all users combined';