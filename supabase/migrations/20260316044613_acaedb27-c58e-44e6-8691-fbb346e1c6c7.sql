
CREATE TABLE public.analysis_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT analysis_queue_status_check CHECK (status IN ('pending', 'processing', 'done', 'failed', 'cancelled'))
);

CREATE INDEX idx_analysis_queue_status ON public.analysis_queue (status, priority DESC, created_at ASC);
CREATE INDEX idx_analysis_queue_recording ON public.analysis_queue (recording_id);

ALTER TABLE public.analysis_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage analysis_queue"
  ON public.analysis_queue FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role full access analysis_queue"
  ON public.analysis_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
