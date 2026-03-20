
-- Table to track session revision requests (one per session, max 1)
CREATE TABLE public.session_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id),
  status text NOT NULL DEFAULT 'open',  -- open | submitted | approved | rejected
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id)
);

ALTER TABLE public.session_revisions ENABLE ROW LEVEL SECURITY;

-- Users can view their own revisions
CREATE POLICY "Users can view own revisions"
  ON public.session_revisions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert revision for own sessions
CREATE POLICY "Users can request revision"
  ON public.session_revisions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update own open revisions (to submit)
CREATE POLICY "Users can update own open revisions"
  ON public.session_revisions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'open');

-- Admins full access
CREATE POLICY "Admins full access session_revisions"
  ON public.session_revisions FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_session_revisions_updated_at
  BEFORE UPDATE ON public.session_revisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
