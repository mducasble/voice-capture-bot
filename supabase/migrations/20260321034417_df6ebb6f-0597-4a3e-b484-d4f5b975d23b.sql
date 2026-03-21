
-- Dataset items table: tracks submissions through the dataset pipeline
CREATE TABLE public.dataset_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  submission_type text NOT NULL, -- audio, video, image, text, annotation
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id),
  user_id uuid NOT NULL,
  
  -- Pipeline status
  pipeline_status text NOT NULL DEFAULT 'quality_approved',
  -- quality_approved → content_validated → transcription_queued → transcribed → dataset_ready → standby
  
  -- Quality stage
  quality_approved_at timestamptz,
  quality_tier text, -- PQ, HQ, MQ
  
  -- Content validation stage
  content_validated_at timestamptz,
  content_score jsonb DEFAULT '{}'::jsonb, -- topic_coverage, speaker_balance, etc.
  
  -- Transcription stage
  transcription_queued_at timestamptz,
  transcription_completed_at timestamptz,
  transcription_provider text, -- elevenlabs, gemini
  
  -- Dataset metadata
  dataset_version text,
  dataset_batch text,
  tags text[] DEFAULT '{}'::text[],
  notes text,
  
  -- Track flags from individual tracks
  has_flagged_tracks boolean DEFAULT false,
  flagged_track_ids uuid[] DEFAULT '{}'::uuid[],
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Prevent duplicates
  UNIQUE(submission_id, submission_type)
);

-- Indexes
CREATE INDEX idx_dataset_items_pipeline ON public.dataset_items(pipeline_status);
CREATE INDEX idx_dataset_items_campaign ON public.dataset_items(campaign_id);
CREATE INDEX idx_dataset_items_submission ON public.dataset_items(submission_id, submission_type);

-- RLS
ALTER TABLE public.dataset_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dataset_items"
ON public.dataset_items FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role full access dataset_items"
ON public.dataset_items FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER update_dataset_items_updated_at
BEFORE UPDATE ON public.dataset_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for pipeline monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.dataset_items;
