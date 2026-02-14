
-- Add audio test tracking columns to room_participants
ALTER TABLE public.room_participants
  ADD COLUMN audio_test_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN audio_test_results jsonb DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.room_participants.audio_test_status IS 'pending | testing | passed | failed';
COMMENT ON COLUMN public.room_participants.audio_test_results IS 'JSON with metrics results and guidance from audio test';
