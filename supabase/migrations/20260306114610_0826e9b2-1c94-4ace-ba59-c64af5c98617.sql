
-- 1) Add validation columns to voice_recordings
ALTER TABLE public.voice_recordings
  ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS quality_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS validation_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS quality_rejection_reason text,
  ADD COLUMN IF NOT EXISTS validation_rejection_reason text,
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2) Create image_submissions table
CREATE TABLE public.image_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  task_set_id uuid REFERENCES public.campaign_task_sets(id),
  section_id uuid REFERENCES public.campaign_sections(id),
  user_id uuid NOT NULL,
  filename text NOT NULL,
  file_url text,
  file_size_bytes bigint,
  format text DEFAULT 'jpg',
  width integer,
  height integer,
  quality_status text DEFAULT 'pending',
  validation_status text DEFAULT 'pending',
  quality_reviewed_at timestamptz,
  quality_reviewed_by uuid,
  quality_rejection_reason text,
  validation_reviewed_at timestamptz,
  validation_reviewed_by uuid,
  validation_rejection_reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.image_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own image submissions" ON public.image_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all image submissions" ON public.image_submissions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own image submissions" ON public.image_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update image submissions" ON public.image_submissions FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete image submissions" ON public.image_submissions FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- 3) Create video_submissions table
CREATE TABLE public.video_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  task_set_id uuid REFERENCES public.campaign_task_sets(id),
  section_id uuid REFERENCES public.campaign_sections(id),
  user_id uuid NOT NULL,
  filename text NOT NULL,
  file_url text,
  file_size_bytes bigint,
  format text DEFAULT 'mp4',
  duration_seconds numeric,
  width integer,
  height integer,
  frame_rate numeric,
  quality_status text DEFAULT 'pending',
  validation_status text DEFAULT 'pending',
  quality_reviewed_at timestamptz,
  quality_reviewed_by uuid,
  quality_rejection_reason text,
  validation_reviewed_at timestamptz,
  validation_reviewed_by uuid,
  validation_rejection_reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own video submissions" ON public.video_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all video submissions" ON public.video_submissions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own video submissions" ON public.video_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update video submissions" ON public.video_submissions FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete video submissions" ON public.video_submissions FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- 4) Create text_submissions table
CREATE TABLE public.text_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  task_set_id uuid REFERENCES public.campaign_task_sets(id),
  section_id uuid REFERENCES public.campaign_sections(id),
  user_id uuid NOT NULL,
  content text,
  word_count integer,
  language text,
  quality_status text DEFAULT 'pending',
  validation_status text DEFAULT 'pending',
  quality_reviewed_at timestamptz,
  quality_reviewed_by uuid,
  quality_rejection_reason text,
  validation_reviewed_at timestamptz,
  validation_reviewed_by uuid,
  validation_rejection_reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.text_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own text submissions" ON public.text_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all text submissions" ON public.text_submissions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own text submissions" ON public.text_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update text submissions" ON public.text_submissions FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete text submissions" ON public.text_submissions FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- 5) Create annotation_submissions table
CREATE TABLE public.annotation_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  task_set_id uuid REFERENCES public.campaign_task_sets(id),
  section_id uuid REFERENCES public.campaign_sections(id),
  user_id uuid NOT NULL,
  source_submission_id uuid,
  source_submission_type text,
  annotation_data jsonb DEFAULT '{}'::jsonb,
  quality_status text DEFAULT 'pending',
  validation_status text DEFAULT 'pending',
  quality_reviewed_at timestamptz,
  quality_reviewed_by uuid,
  quality_rejection_reason text,
  validation_reviewed_at timestamptz,
  validation_reviewed_by uuid,
  validation_rejection_reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.annotation_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own annotation submissions" ON public.annotation_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all annotation submissions" ON public.annotation_submissions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own annotation submissions" ON public.annotation_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update annotation submissions" ON public.annotation_submissions FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete annotation submissions" ON public.annotation_submissions FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- 6) Create earnings_ledger table
CREATE TABLE public.earnings_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  submission_type text NOT NULL, -- 'audio', 'image', 'video', 'text', 'annotation'
  entry_type text NOT NULL DEFAULT 'task_payment', -- 'task_payment', 'referral_bonus', 'bonus', 'adjustment', 'withdrawal'
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'credited', 'paid', 'cancelled'
  description text,
  reference_id uuid, -- for referral: points to the original earning
  metadata jsonb DEFAULT '{}'::jsonb,
  credited_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.earnings_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own earnings" ON public.earnings_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all earnings" ON public.earnings_ledger FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert earnings" ON public.earnings_ledger FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update earnings" ON public.earnings_ledger FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- 7) Add updated_at triggers
CREATE TRIGGER update_image_submissions_updated_at BEFORE UPDATE ON public.image_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_video_submissions_updated_at BEFORE UPDATE ON public.video_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_text_submissions_updated_at BEFORE UPDATE ON public.text_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_annotation_submissions_updated_at BEFORE UPDATE ON public.annotation_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_earnings_ledger_updated_at BEFORE UPDATE ON public.earnings_ledger FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8) Create indexes for performance
CREATE INDEX idx_earnings_ledger_user_id ON public.earnings_ledger(user_id);
CREATE INDEX idx_earnings_ledger_campaign_id ON public.earnings_ledger(campaign_id);
CREATE INDEX idx_earnings_ledger_status ON public.earnings_ledger(status);
CREATE INDEX idx_image_submissions_campaign ON public.image_submissions(campaign_id);
CREATE INDEX idx_image_submissions_user ON public.image_submissions(user_id);
CREATE INDEX idx_video_submissions_campaign ON public.video_submissions(campaign_id);
CREATE INDEX idx_video_submissions_user ON public.video_submissions(user_id);
CREATE INDEX idx_text_submissions_campaign ON public.text_submissions(campaign_id);
CREATE INDEX idx_text_submissions_user ON public.text_submissions(user_id);
CREATE INDEX idx_annotation_submissions_campaign ON public.annotation_submissions(campaign_id);
CREATE INDEX idx_annotation_submissions_user ON public.annotation_submissions(user_id);
CREATE INDEX idx_voice_recordings_validation ON public.voice_recordings(validation_status);
CREATE INDEX idx_voice_recordings_user ON public.voice_recordings(user_id);
