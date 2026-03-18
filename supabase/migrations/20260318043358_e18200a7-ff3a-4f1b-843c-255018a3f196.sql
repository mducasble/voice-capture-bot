ALTER TABLE public.analysis_queue
  ADD COLUMN IF NOT EXISTS current_segment integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_segments integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS segment_data jsonb DEFAULT '{}'::jsonb;