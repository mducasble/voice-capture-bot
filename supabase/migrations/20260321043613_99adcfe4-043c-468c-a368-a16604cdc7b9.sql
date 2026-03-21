
-- Add new taxonomy columns to datasets
ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS modalities text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS task_family text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS task_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS consent_status text DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS legal_review_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS annotation_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS qc_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS policy_profile text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS splits text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS video_profile jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS audio_profile jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS image_profile jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS text_profile jsonb DEFAULT '{}'::jsonb;

-- Migrate content_types → modalities for existing data
UPDATE public.datasets SET modalities = content_types WHERE content_types IS NOT NULL AND modalities = '{}';

-- Add version_status and snapshot_type to dataset_versions
ALTER TABLE public.dataset_versions
  ADD COLUMN IF NOT EXISTS version_status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS snapshot_type text DEFAULT 'dynamic_reference';
