-- Add column to store ElevenLabs chunk processing state (lock + progress)
ALTER TABLE public.voice_recordings
ADD COLUMN IF NOT EXISTS elevenlabs_chunk_state jsonb DEFAULT NULL;

-- This jsonb will contain:
-- {
--   "chunkNames": ["file1.wav", "file2.wav", ...],
--   "nextIndex": 0,
--   "lockedAt": "2024-01-01T00:00:00Z"
-- }

COMMENT ON COLUMN public.voice_recordings.elevenlabs_chunk_state IS 'Stores ElevenLabs chunk transcription state for idempotent processing. Contains chunkNames array, nextIndex, and lockedAt timestamp for locking.';