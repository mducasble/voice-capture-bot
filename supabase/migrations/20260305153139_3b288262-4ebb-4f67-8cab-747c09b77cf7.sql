
-- 1. Add new columns to campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS schema_version text DEFAULT 'campaign.v1';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS language_primary text;

-- 2. Create task_type_catalog
CREATE TABLE IF NOT EXISTS task_type_catalog (
  task_type text PRIMARY KEY,
  category text NOT NULL,
  ui_label text NOT NULL,
  primary_unit text NOT NULL DEFAULT 'hour',
  secondary_unit text,
  default_admin_rules jsonb DEFAULT '{}',
  default_tech_validation jsonb DEFAULT '{}',
  default_content_validation jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE task_type_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read task_type_catalog" ON task_type_catalog FOR SELECT USING (true);
CREATE POLICY "Allow insert task_type_catalog" ON task_type_catalog FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update task_type_catalog" ON task_type_catalog FOR UPDATE USING (true);
CREATE POLICY "Allow delete task_type_catalog" ON task_type_catalog FOR DELETE USING (true);

-- 3. Create campaign_task_sets
CREATE TABLE IF NOT EXISTS campaign_task_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  task_set_id text NOT NULL,
  task_type text NOT NULL REFERENCES task_type_catalog(task_type),
  enabled boolean DEFAULT true,
  weight integer DEFAULT 1,
  instructions_title text,
  instructions_summary text,
  prompt_topic text,
  prompt_do text[] DEFAULT '{}',
  prompt_dont text[] DEFAULT '{}',
  admin_rules jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(campaign_id, task_set_id)
);

ALTER TABLE campaign_task_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read campaign_task_sets" ON campaign_task_sets FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_task_sets" ON campaign_task_sets FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update campaign_task_sets" ON campaign_task_sets FOR UPDATE USING (true);
CREATE POLICY "Allow delete campaign_task_sets" ON campaign_task_sets FOR DELETE USING (true);

-- 4. Add task_set_id to existing validation tables
ALTER TABLE campaign_audio_validation ADD COLUMN IF NOT EXISTS task_set_id uuid REFERENCES campaign_task_sets(id) ON DELETE CASCADE;
ALTER TABLE campaign_content_validation ADD COLUMN IF NOT EXISTS task_set_id uuid REFERENCES campaign_task_sets(id) ON DELETE CASCADE;

-- 5. Create per-category validation tables (image)
CREATE TABLE IF NOT EXISTS campaign_image_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_set_id uuid NOT NULL REFERENCES campaign_task_sets(id) ON DELETE CASCADE,
  validation_scope text NOT NULL DEFAULT 'technical',
  rule_key text NOT NULL,
  min_value numeric,
  max_value numeric,
  target_value numeric,
  allowed_values jsonb,
  config jsonb DEFAULT '{}',
  is_critical boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE campaign_image_validation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read campaign_image_validation" ON campaign_image_validation FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_image_validation" ON campaign_image_validation FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_image_validation" ON campaign_image_validation FOR DELETE USING (true);

-- 6. Create per-category validation tables (video)
CREATE TABLE IF NOT EXISTS campaign_video_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_set_id uuid NOT NULL REFERENCES campaign_task_sets(id) ON DELETE CASCADE,
  validation_scope text NOT NULL DEFAULT 'technical',
  rule_key text NOT NULL,
  min_value numeric,
  max_value numeric,
  target_value numeric,
  allowed_values jsonb,
  config jsonb DEFAULT '{}',
  is_critical boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE campaign_video_validation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read campaign_video_validation" ON campaign_video_validation FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_video_validation" ON campaign_video_validation FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_video_validation" ON campaign_video_validation FOR DELETE USING (true);

-- 7. Create per-category validation tables (annotation - data_labeling)
CREATE TABLE IF NOT EXISTS campaign_annotation_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_set_id uuid NOT NULL REFERENCES campaign_task_sets(id) ON DELETE CASCADE,
  validation_scope text NOT NULL DEFAULT 'technical',
  rule_key text NOT NULL,
  min_value numeric,
  max_value numeric,
  target_value numeric,
  allowed_values jsonb,
  config jsonb DEFAULT '{}',
  is_critical boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE campaign_annotation_validation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read campaign_annotation_validation" ON campaign_annotation_validation FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_annotation_validation" ON campaign_annotation_validation FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_annotation_validation" ON campaign_annotation_validation FOR DELETE USING (true);

-- 8. Create per-category validation tables (text - transcription)
CREATE TABLE IF NOT EXISTS campaign_text_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_set_id uuid NOT NULL REFERENCES campaign_task_sets(id) ON DELETE CASCADE,
  validation_scope text NOT NULL DEFAULT 'technical',
  rule_key text NOT NULL,
  min_value numeric,
  max_value numeric,
  target_value numeric,
  allowed_values jsonb,
  config jsonb DEFAULT '{}',
  is_critical boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE campaign_text_validation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read campaign_text_validation" ON campaign_text_validation FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_text_validation" ON campaign_text_validation FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_text_validation" ON campaign_text_validation FOR DELETE USING (true);

-- 9. Create per-category validation tables (review - prompt_review, image_review)
CREATE TABLE IF NOT EXISTS campaign_review_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_set_id uuid NOT NULL REFERENCES campaign_task_sets(id) ON DELETE CASCADE,
  validation_scope text NOT NULL DEFAULT 'technical',
  rule_key text NOT NULL,
  min_value numeric,
  max_value numeric,
  target_value numeric,
  allowed_values jsonb,
  config jsonb DEFAULT '{}',
  is_critical boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE campaign_review_validation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read campaign_review_validation" ON campaign_review_validation FOR SELECT USING (true);
CREATE POLICY "Allow insert campaign_review_validation" ON campaign_review_validation FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete campaign_review_validation" ON campaign_review_validation FOR DELETE USING (true);

-- 10. Seed task_type_catalog with 8 types
INSERT INTO task_type_catalog (task_type, category, ui_label, primary_unit, secondary_unit, default_admin_rules, default_tech_validation, default_content_validation, sort_order) VALUES
('audio_capture_solo', 'audio', 'Captura de Áudio (Solo)', 'hour', 'session',
  '{"max_hours_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"},"additional_limits":{"max_sessions_per_user":0}}',
  '{"audio_sampling_rate":{"target_value_hz":48000,"allowed_values_hz":[16000,24000,44100,48000],"is_critical":true},"mic_sampling_rate":{"min_value_hz":44100,"is_critical":false},"rms_level":{"min_db":-26,"max_db":-18,"is_critical":true},"signal_to_noise_ratio":{"min_db":25,"is_critical":true},"srmr":{"min_value":6.0,"is_critical":false},"sigmos_disc":{"min_value":3.5,"is_critical":false},"vqscore":{"min_value":3.5,"is_critical":false},"wvmos":{"min_value":3.5,"is_critical":false},"sigmos_overall":{"min_value":3.5,"is_critical":false},"sigmos_reverb":{"max_value":2.5,"is_critical":false},"clipping_ratio":{"max_value":0.01,"is_critical":true},"silence_ratio":{"max_value":0.25,"is_critical":false}}',
  '{"topic_coverage_ratio":{"min_value":0.6,"is_critical":true},"personal_reference_ratio":{"min_value":0.15,"is_critical":false},"named_entity_mentions":{"max_value":5,"is_critical":false},"speaker_balance_ratio":{"min_value":0.0,"max_value":1.0,"is_critical":false}}',
  1),
('audio_capture_group', 'audio', 'Captura de Áudio (Grupo)', 'hour', 'session',
  '{"max_hours_per_user":0,"max_hours_per_partner_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"},"additional_limits":{"max_sessions_per_user":0,"min_participants_per_session":2,"max_participants_per_session":3}}',
  '{"audio_sampling_rate":{"target_value_hz":48000,"allowed_values_hz":[16000,24000,44100,48000],"is_critical":true},"mic_sampling_rate":{"min_value_hz":44100,"is_critical":false},"rms_level":{"min_db":-26,"max_db":-18,"is_critical":true},"signal_to_noise_ratio":{"min_db":25,"is_critical":true},"srmr":{"min_value":6.0,"is_critical":false},"sigmos_disc":{"min_value":3.5,"is_critical":false},"vqscore":{"min_value":3.5,"is_critical":false},"wvmos":{"min_value":3.5,"is_critical":false},"sigmos_overall":{"min_value":3.5,"is_critical":false},"sigmos_reverb":{"max_value":2.5,"is_critical":false},"clipping_ratio":{"max_value":0.01,"is_critical":true},"silence_ratio":{"max_value":0.25,"is_critical":false}}',
  '{"topic_coverage_ratio":{"min_value":0.6,"is_critical":true},"personal_reference_ratio":{"min_value":0.15,"is_critical":false},"named_entity_mentions":{"max_value":5,"is_critical":false},"speaker_balance_ratio":{"min_value":0.35,"max_value":0.65,"is_critical":false}}',
  2),
('image_submission', 'image', 'Envio de Imagens e Fotos', 'image', 'batch',
  '{"max_images_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"},"additional_limits":{"max_images_per_day":0}}',
  '{"original_metadata_required":{"value":false,"is_critical":true},"minimum_resolution":{"min_width_px":0,"min_height_px":0,"is_critical":true},"maximum_resolution":{"max_width_px":0,"max_height_px":0,"is_critical":false},"allowed_formats":{"values":["jpg","jpeg","png","webp"],"is_critical":true},"aspect_ratio":{"allowed_values":[],"is_critical":false},"blur_detection_score":{"max_value":0,"is_critical":false}}',
  '{"prompt_compliance":{"min_score":0,"is_critical":true},"nsfw_filter":{"must_pass":true,"is_critical":true},"logo_detection":{"must_pass":true,"is_critical":false}}',
  3),
('video_submission', 'video', 'Envio ou Gravação de Vídeos', 'hour', 'video',
  '{"max_hours_per_user":0,"max_partners_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"},"additional_limits":{"max_videos_per_user":0}}',
  '{"original_metadata_required":{"value":false,"is_critical":true},"minimum_resolution":{"min_width_px":0,"min_height_px":0,"is_critical":true},"maximum_resolution":{"max_width_px":0,"max_height_px":0,"is_critical":false},"video_duration":{"min_seconds":0,"max_seconds":0,"is_critical":true},"allowed_formats":{"values":["mp4","mov","webm"],"is_critical":true},"frame_rate":{"min_fps":0,"max_fps":0,"is_critical":false},"bitrate":{"min_kbps":0,"is_critical":false},"audio_track_required":{"value":true,"is_critical":false}}',
  '{"prompt_compliance":{"min_score":0,"is_critical":true},"nsfw_filter":{"must_pass":true,"is_critical":true}}',
  4),
('data_labeling', 'annotation', 'Data Labelling', 'task', 'batch',
  '{"max_tasks_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"}}',
  '{"labeling_schema_version":{"value":"v1","is_critical":true},"required_fields_present":{"must_pass":true,"is_critical":true}}',
  '{"annotation_accuracy":{"min_value":0,"is_critical":true},"inter_annotator_agreement":{"min_value":0,"is_critical":false}}',
  5),
('transcription', 'text', 'Transcrição', 'minute', 'file',
  '{"max_minutes_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"}}',
  '{"timestamp_required":{"value":true,"is_critical":true},"timestamp_granularity":{"allowed_values":["word","sentence","segment"],"is_critical":false},"format":{"allowed_values":["json","srt","vtt","txt"],"is_critical":true}}',
  '{"word_accuracy_rate":{"min_value":0,"is_critical":true},"punctuation_accuracy":{"min_value":0,"is_critical":false},"speaker_identification":{"required":false,"is_critical":false}}',
  6),
('prompt_review', 'review', 'Revisão de Prompt', 'prompt', 'batch',
  '{"max_reviews_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"}}',
  '{"prompt_format_valid":{"must_pass":true,"is_critical":true},"language_match_required":{"value":true,"is_critical":false}}',
  '{"prompt_quality_score":{"min_value":0,"is_critical":false},"prompt_safety_check":{"must_pass":true,"is_critical":true},"bias_detection":{"must_pass":true,"is_critical":false}}',
  7),
('image_review', 'review', 'Revisão de Imagem', 'image', 'batch',
  '{"max_reviews_per_user":0,"minimum_acceptance_rate":{"value":0,"unit":"percent"}}',
  '{"image_integrity":{"must_pass":true,"is_critical":true},"metadata_required":{"value":false,"is_critical":false}}',
  '{"image_label_accuracy":{"min_value":0,"is_critical":true},"prompt_alignment":{"min_score":0,"is_critical":false},"nsfw_filter":{"must_pass":true,"is_critical":true}}',
  8)
ON CONFLICT (task_type) DO NOTHING;

-- 11. Migrate existing campaign_task_config data to campaign_task_sets
INSERT INTO campaign_task_sets (campaign_id, task_set_id, task_type, enabled, instructions_title, instructions_summary, prompt_topic, prompt_do, prompt_dont, admin_rules)
SELECT
  tc.campaign_id,
  'set_' || COALESCE(tc.task_type, 'audio_capture_group') || '_001',
  COALESCE(tc.task_type, 'audio_capture_group'),
  true,
  tc.instructions_title,
  tc.instructions_summary,
  tc.prompt_topic,
  COALESCE(tc.prompt_do, '{}'),
  COALESCE(tc.prompt_dont, '{}'),
  COALESCE(
    (SELECT jsonb_build_object(
      'max_hours_per_user', ar.max_hours_per_user,
      'max_hours_per_partner_per_user', ar.max_hours_per_partner_per_user,
      'minimum_acceptance_rate', jsonb_build_object('value', ar.min_acceptance_rate, 'unit', COALESCE(ar.min_acceptance_rate_unit, 'percent')),
      'additional_limits', jsonb_build_object(
        'max_sessions_per_user', ar.max_sessions_per_user,
        'min_participants_per_session', ar.min_participants_per_session,
        'max_participants_per_session', ar.max_participants_per_session
      )
    ) FROM campaign_administrative_rules ar WHERE ar.campaign_id = tc.campaign_id),
    '{}'
  )
FROM campaign_task_config tc
WHERE EXISTS (SELECT 1 FROM task_type_catalog ttc WHERE ttc.task_type = COALESCE(tc.task_type, 'audio_capture_group'))
ON CONFLICT (campaign_id, task_set_id) DO NOTHING;

-- 12. Link existing audio_validation to task_sets
UPDATE campaign_audio_validation av
SET task_set_id = ts.id
FROM campaign_task_sets ts
WHERE ts.campaign_id = av.campaign_id AND av.task_set_id IS NULL;

-- 13. Link existing content_validation to task_sets
UPDATE campaign_content_validation cv
SET task_set_id = ts.id
FROM campaign_task_sets ts
WHERE ts.campaign_id = cv.campaign_id AND cv.task_set_id IS NULL;

-- 14. Update quality_flow default rejection_reasons (handled in code, not migration)
