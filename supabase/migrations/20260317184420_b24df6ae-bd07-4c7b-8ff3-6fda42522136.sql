
-- Validation task configuration per task_set
CREATE TABLE public.validation_task_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_set_id uuid NOT NULL REFERENCES public.campaign_task_sets(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  content_type text NOT NULL DEFAULT 'audio',
  time_limit_seconds integer NOT NULL DEFAULT 300,
  tracked_actions text[] NOT NULL DEFAULT '{play,pause,seek,enhance,reanalyze}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(task_set_id)
);

ALTER TABLE public.validation_task_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage validation_task_config"
  ON public.validation_task_config FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can read validation_task_config"
  ON public.validation_task_config FOR SELECT
  TO authenticated
  USING (true);

-- Validation task execution log
CREATE TABLE public.validation_task_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  task_set_id uuid NOT NULL REFERENCES public.campaign_task_sets(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  submission_type text NOT NULL DEFAULT 'audio',
  status text NOT NULL DEFAULT 'in_progress',
  actions_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  time_spent_seconds integer NOT NULL DEFAULT 0,
  result jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.validation_task_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage validation_task_log"
  ON public.validation_task_log FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert own task logs"
  ON public.validation_task_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own in-progress task logs"
  ON public.validation_task_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'in_progress');

CREATE POLICY "Users can view own task logs"
  ON public.validation_task_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_validation_task_log_user ON public.validation_task_log(user_id);
CREATE INDEX idx_validation_task_log_campaign ON public.validation_task_log(campaign_id);
CREATE INDEX idx_validation_task_log_submission ON public.validation_task_log(submission_id);

-- Add total_review_seconds to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_review_seconds integer NOT NULL DEFAULT 0;

-- Trigger for updated_at on config
CREATE TRIGGER update_validation_task_config_updated_at
  BEFORE UPDATE ON public.validation_task_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
