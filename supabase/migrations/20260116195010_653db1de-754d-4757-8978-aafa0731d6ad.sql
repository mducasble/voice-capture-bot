-- Add SNR column to voice_recordings table
ALTER TABLE public.voice_recordings
ADD COLUMN snr_db numeric NULL,
ADD COLUMN quality_status text NULL DEFAULT 'pending';

-- Add comment for documentation
COMMENT ON COLUMN public.voice_recordings.snr_db IS 'Signal-to-Noise Ratio in decibels';
COMMENT ON COLUMN public.voice_recordings.quality_status IS 'Quality check status: pending, passed, failed';