
-- =============================================
-- DATASETS: Core blueprint/datacard table
-- =============================================
CREATE TABLE public.datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, active, archived
  content_types TEXT[] NOT NULL DEFAULT '{}', -- audio, video, text, image, annotation
  
  -- Datacard fields
  objective TEXT,
  primary_task TEXT,
  data_origin TEXT,
  population_coverage TEXT,
  collection_process TEXT,
  exclusion_criteria TEXT,
  annotation_process TEXT,
  quality_metrics TEXT,
  known_limitations TEXT,
  risks TEXT,
  recommended_uses TEXT,
  not_recommended_uses TEXT,
  license_restrictions TEXT,
  
  -- Metadata
  tags TEXT[] DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage datasets"
  ON public.datasets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Datasets are viewable by authenticated users"
  ON public.datasets FOR SELECT TO authenticated
  USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_datasets_updated_at
  BEFORE UPDATE ON public.datasets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- DATASET PIPELINE STAGES: Custom workflow steps
-- =============================================
CREATE TABLE public.dataset_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  stage_type TEXT NOT NULL DEFAULT 'manual', -- manual, automated
  automation_config JSONB DEFAULT NULL, -- e.g. {"action": "analyze-content"}
  validation_rules JSONB DEFAULT NULL, -- criteria to pass
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dataset_pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage pipeline stages"
  ON public.dataset_pipeline_stages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Pipeline stages viewable by authenticated"
  ON public.dataset_pipeline_stages FOR SELECT TO authenticated
  USING (true);

CREATE UNIQUE INDEX idx_dataset_pipeline_stages_unique ON public.dataset_pipeline_stages(dataset_id, stage_key);

-- =============================================
-- DATASET QUALITY PARAMS: Per content-type rules
-- =============================================
CREATE TABLE public.dataset_quality_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL, -- audio, video, text, image
  rules JSONB NOT NULL DEFAULT '{}', -- flexible: {min_snr: 20, min_duration: 30, ...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dataset_quality_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage quality params"
  ON public.dataset_quality_params FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Quality params viewable by authenticated"
  ON public.dataset_quality_params FOR SELECT TO authenticated
  USING (true);

CREATE UNIQUE INDEX idx_dataset_quality_params_unique ON public.dataset_quality_params(dataset_id, content_type);

-- =============================================
-- DATASET ↔ CAMPAIGNS: Many-to-many
-- =============================================
CREATE TABLE public.dataset_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dataset_id, campaign_id)
);

ALTER TABLE public.dataset_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dataset campaigns"
  ON public.dataset_campaigns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Dataset campaigns viewable by authenticated"
  ON public.dataset_campaigns FOR SELECT TO authenticated
  USING (true);

-- =============================================
-- DATASET VERSIONS: Immutable snapshots
-- =============================================
CREATE TABLE public.dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL, -- v1, v2, v1.1, etc.
  changelog TEXT,
  item_count INT DEFAULT 0,
  total_duration_seconds NUMERIC DEFAULT 0,
  stats JSONB DEFAULT '{}', -- flexible stats snapshot
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by TEXT,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dataset_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dataset versions"
  ON public.dataset_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Dataset versions viewable by authenticated"
  ON public.dataset_versions FOR SELECT TO authenticated
  USING (true);

-- =============================================
-- Add dataset_id to existing dataset_items
-- =============================================
ALTER TABLE public.dataset_items 
  ADD COLUMN IF NOT EXISTS dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL;

CREATE INDEX idx_dataset_items_dataset_id ON public.dataset_items(dataset_id);
