
-- 1. Add new columns to campaigns
ALTER TABLE campaigns 
  ADD COLUMN IF NOT EXISTS campaign_type text DEFAULT 'audio_capture_group',
  ADD COLUMN IF NOT EXISTS campaign_status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS duration_unit text DEFAULT 'days',
  ADD COLUMN IF NOT EXISTS duration_value integer,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS visibility_is_public boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_id text;

-- 2. campaign_geographic_scope
CREATE TABLE IF NOT EXISTS campaign_geographic_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  restriction_mode text DEFAULT 'include',
  continents text[] DEFAULT '{}',
  countries text[] DEFAULT '{}',
  regions text[] DEFAULT '{}',
  states text[] DEFAULT '{}',
  cities text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id)
);

-- 3. campaign_language_variants
CREATE TABLE IF NOT EXISTS campaign_language_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  variant_id text NOT NULL,
  label text NOT NULL,
  notes text,
  is_primary boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, variant_id)
);

-- 4. campaign_task_config
CREATE TABLE IF NOT EXISTS campaign_task_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  task_type text DEFAULT 'audio_capture_group',
  instructions_title text,
  instructions_summary text,
  prompt_topic text,
  prompt_do text[] DEFAULT '{}',
  prompt_dont text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id)
);

-- 5. campaign_administrative_rules
CREATE TABLE IF NOT EXISTS campaign_administrative_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  max_hours_per_user numeric,
  max_hours_per_partner_per_user numeric,
  min_acceptance_rate numeric,
  min_acceptance_rate_unit text DEFAULT 'percent',
  max_sessions_per_user integer,
  min_participants_per_session integer,
  max_participants_per_session integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id)
);

-- 6. campaign_audio_validation (key-value for flexibility)
CREATE TABLE IF NOT EXISTS campaign_audio_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  min_value numeric,
  max_value numeric,
  target_value numeric,
  allowed_values jsonb,
  is_critical boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, rule_key)
);

-- 7. campaign_content_validation
CREATE TABLE IF NOT EXISTS campaign_content_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  min_value numeric,
  max_value numeric,
  is_critical boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, rule_key)
);

-- 8. campaign_reward_config
CREATE TABLE IF NOT EXISTS campaign_reward_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  currency text DEFAULT 'USD',
  payout_model text DEFAULT 'per_accepted_hour',
  base_rate numeric,
  bonus_rate numeric,
  bonus_condition text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id)
);

-- 9. campaign_quality_flow
CREATE TABLE IF NOT EXISTS campaign_quality_flow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  review_mode text DEFAULT 'hybrid',
  sampling_rate_value numeric,
  sampling_rate_unit text DEFAULT 'percent',
  rejection_reasons text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id)
);

-- Enable RLS on all new tables
ALTER TABLE campaign_geographic_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_language_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_task_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_administrative_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_audio_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_content_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_reward_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_quality_flow ENABLE ROW LEVEL SECURITY;

-- RLS policies for all new tables
CREATE POLICY "Allow public read campaign_geographic_scope" ON campaign_geographic_scope FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_geographic_scope" ON campaign_geographic_scope FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update campaign_geographic_scope" ON campaign_geographic_scope FOR UPDATE USING (true);
CREATE POLICY "Allow delete campaign_geographic_scope" ON campaign_geographic_scope FOR DELETE USING (true);

CREATE POLICY "Allow public read campaign_language_variants" ON campaign_language_variants FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_language_variants" ON campaign_language_variants FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_language_variants" ON campaign_language_variants FOR DELETE USING (true);

CREATE POLICY "Allow public read campaign_task_config" ON campaign_task_config FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_task_config" ON campaign_task_config FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update campaign_task_config" ON campaign_task_config FOR UPDATE USING (true);
CREATE POLICY "Allow delete campaign_task_config" ON campaign_task_config FOR DELETE USING (true);

CREATE POLICY "Allow public read campaign_administrative_rules" ON campaign_administrative_rules FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_administrative_rules" ON campaign_administrative_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update campaign_administrative_rules" ON campaign_administrative_rules FOR UPDATE USING (true);
CREATE POLICY "Allow delete campaign_administrative_rules" ON campaign_administrative_rules FOR DELETE USING (true);

CREATE POLICY "Allow public read campaign_audio_validation" ON campaign_audio_validation FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_audio_validation" ON campaign_audio_validation FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_audio_validation" ON campaign_audio_validation FOR DELETE USING (true);

CREATE POLICY "Allow public read campaign_content_validation" ON campaign_content_validation FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_content_validation" ON campaign_content_validation FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_content_validation" ON campaign_content_validation FOR DELETE USING (true);

CREATE POLICY "Allow public read campaign_reward_config" ON campaign_reward_config FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_reward_config" ON campaign_reward_config FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update campaign_reward_config" ON campaign_reward_config FOR UPDATE USING (true);
CREATE POLICY "Allow delete campaign_reward_config" ON campaign_reward_config FOR DELETE USING (true);

CREATE POLICY "Allow public read campaign_quality_flow" ON campaign_quality_flow FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_quality_flow" ON campaign_quality_flow FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update campaign_quality_flow" ON campaign_quality_flow FOR UPDATE USING (true);
CREATE POLICY "Allow delete campaign_quality_flow" ON campaign_quality_flow FOR DELETE USING (true);

-- Migrate existing audio data from campaigns to campaign_audio_validation
INSERT INTO campaign_audio_validation (campaign_id, rule_key, target_value, is_critical)
SELECT id, 'audio_sampling_rate', audio_sample_rate, true
FROM campaigns WHERE audio_sample_rate IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO campaign_audio_validation (campaign_id, rule_key, target_value, is_critical)
SELECT id, 'bit_depth', audio_bit_depth, false
FROM campaigns WHERE audio_bit_depth IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO campaign_audio_validation (campaign_id, rule_key, min_value, is_critical)
SELECT id, 'signal_to_noise_ratio', audio_min_snr_db, true
FROM campaigns WHERE audio_min_snr_db IS NOT NULL
ON CONFLICT DO NOTHING;

-- Migrate geographic data from campaign_regions
INSERT INTO campaign_geographic_scope (campaign_id, restriction_mode, regions)
SELECT cr.campaign_id, 'include', array_agg(r.code)
FROM campaign_regions cr
JOIN regions r ON r.id = cr.region_id
GROUP BY cr.campaign_id
ON CONFLICT DO NOTHING;

-- Migrate language data
INSERT INTO campaign_language_variants (campaign_id, variant_id, label, is_primary)
SELECT cl.campaign_id, l.code, l.name, true
FROM campaign_languages cl
JOIN languages l ON l.id = cl.language_id
ON CONFLICT DO NOTHING;
