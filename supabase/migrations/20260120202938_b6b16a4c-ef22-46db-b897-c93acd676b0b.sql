-- Add column to store Gemini chunk processing state (for resumable transcription)
ALTER TABLE public.voice_recordings
ADD COLUMN IF NOT EXISTS gemini_chunk_state jsonb DEFAULT NULL;

-- This jsonb will contain:
-- {
--   "chunkUrls": [{ "url": "...", "index": 0 }, ...],
--   "nextIndex": 0,
--   "transcriptions": ["chunk1 text", "chunk2 text", ...],
--   "detectedLanguage": "en",
--   "lockedAt": "2024-01-01T00:00:00Z"
-- }

COMMENT ON COLUMN public.voice_recordings.gemini_chunk_state IS 'Stores Gemini chunk transcription state for resumable processing. Contains chunkUrls array, nextIndex, transcriptions array, detectedLanguage, and lockedAt timestamp for locking.';