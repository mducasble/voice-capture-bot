// Campaign system types — v2 with task_type_catalog + campaign_task_sets

export interface Client {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface GeographicScope {
  id?: string;
  campaign_id?: string;
  restriction_mode: string;
  continents: string[];
  countries: string[];
  regions: string[];
  states: string[];
  cities: string[];
}

export interface LanguageVariant {
  id?: string;
  campaign_id?: string;
  variant_id: string;
  label: string;
  notes: string | null;
  is_primary: boolean;
}

export interface RewardConfig {
  id?: string;
  campaign_id?: string;
  currency: string;
  payout_model: string;
  base_rate: number | null;
  bonus_rate: number | null;
  bonus_condition: string | null;
  payment_type: string;
}

export interface ReferralConfig {
  id?: string;
  campaign_id?: string | null;
  pool_percent: number;
  pool_fixed_amount?: number | null;
  cascade_keep_ratio: number;
  max_levels: number;
}

export interface HardwareCatalogItem {
  id: string;
  name: string;
  icon_name: string;
  created_at: string;
}

export interface CampaignInstructions {
  id?: string;
  campaign_id?: string;
  instructions_title: string | null;
  instructions_summary: string | null;
  prompt_do: string[];
  prompt_dont: string[];
  required_hardware: string[];
  video_url: string | null;
  pdf_file_url: string | null;
}

export interface QualityFlow {
  id?: string;
  campaign_id?: string;
  review_mode: string;
  sampling_rate_value: number | null;
  sampling_rate_unit: string;
  rejection_reasons: string[];
}

export interface CampaignSection {
  id?: string;
  campaign_id?: string;
  name: string;
  description: string | null;
  prompt_text: string | null;
  target_hours: number | null;
  sort_order: number;
  is_active: boolean;
}

// --- Task Type Catalog ---

export interface TaskTypeCatalog {
  task_type: string;
  category: string;
  ui_label: string;
  primary_unit: string;
  secondary_unit: string | null;
  default_admin_rules: Record<string, any>;
  default_tech_validation: Record<string, any>;
  default_content_validation: Record<string, any>;
  is_active: boolean;
  sort_order: number;
}

// --- Campaign Task Sets ---

export interface CampaignTaskSet {
  id?: string;
  campaign_id?: string;
  task_set_id: string;
  task_type: string;
  enabled: boolean;
  weight: number;
  instructions_title: string | null;
  instructions_summary: string | null;
  prompt_topic: string | null;
  prompt_do: string[];
  prompt_dont: string[];
  admin_rules: Record<string, any>;
  // Loaded relations per category
  tech_validation?: ValidationRule[];
  content_validation?: ValidationRule[];
}

// Generic validation rule used across all category tables
export interface ValidationRule {
  id?: string;
  task_set_id?: string;
  campaign_id?: string; // legacy (audio/content tables)
  validation_scope?: string; // 'technical' | 'content' (new tables)
  rule_key: string;
  min_value: number | null;
  max_value: number | null;
  target_value?: number | null;
  allowed_values?: any | null;
  config?: Record<string, any> | null;
  is_critical: boolean;
}

// --- Campaign ---

export interface AdministrativeRules {
  id?: string;
  campaign_id?: string;
  max_hours_per_user: number | null;
  max_hours_per_partner_per_user: number | null;
  min_acceptance_rate: number | null;
  min_acceptance_rate_unit: string | null;
  max_sessions_per_user: number | null;
  min_participants_per_session: number | null;
  max_participants_per_session: number | null;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  client_id: string | null;
  start_date: string | null;
  end_date: string | null;
  target_hours: number | null;
  is_active: boolean | null;
  campaign_type: string | null;
  campaign_status: string | null;
  duration_unit: string | null;
  duration_value: number | null;
  timezone: string | null;
  visibility_is_public: boolean | null;
  partner_id: string | null;
  schema_version: string | null;
  language_primary: string | null;
  created_at: string;
  updated_at: string;
  // Legacy columns
  audio_sample_rate: number | null;
  audio_bit_depth: number | null;
  audio_channels: number | null;
  audio_format: string | null;
  audio_min_duration_seconds: number | null;
  audio_max_duration_seconds: number | null;
  audio_min_snr_db: number | null;
  // Relations
  client?: Client | null;
  geographic_scope?: GeographicScope | null;
  language_variants?: LanguageVariant[];
  task_sets?: CampaignTaskSet[];
  reward_config?: RewardConfig | null;
  referral_config?: ReferralConfig | null;
  quality_flow?: QualityFlow | null;
  administrative_rules?: AdministrativeRules | null;
  instructions?: CampaignInstructions | null;
  sections?: CampaignSection[];
  // Legacy relations (kept for backward compat)
  task_config?: any | null;
  audio_validation?: ValidationRule[];
  content_validation?: ValidationRule[];
}

// Category → validation table name mapping
export const CATEGORY_VALIDATION_TABLE: Record<string, string> = {
  audio: "campaign_audio_validation",
  image: "campaign_image_validation",
  video: "campaign_video_validation",
  annotation: "campaign_annotation_validation",
  text: "campaign_text_validation",
  review: "campaign_review_validation",
};

// Audio-specific validation tables (legacy)
export const AUDIO_CONTENT_TABLE = "campaign_content_validation";

// Default rejection reasons catalog
export const DEFAULT_REJECTION_REASONS = [
  "low_snr",
  "rms_out_of_range",
  "metadata_missing",
  "prompt_non_compliance",
  "topic_not_covered",
  "invalid_format",
  "resolution_out_of_range",
  "duration_out_of_range",
];

// Rule labels for display
export const RULE_LABELS: Record<string, string> = {
  // Audio tech
  audio_sampling_rate: "Sample Rate (Hz)",
  mic_sampling_rate: "Mic Sample Rate (Hz)",
  rms_level: "Nível RMS (dB)",
  signal_to_noise_ratio: "SNR (dB)",
  srmr: "SRMR",
  sigmos_disc: "SigMOS DISC",
  vqscore: "VQScore",
  wvmos: "WVMOS",
  sigmos_overall: "SigMOS Overall",
  sigmos_reverb: "SigMOS Reverb",
  clipping_ratio: "Clipping Ratio",
  silence_ratio: "Silence Ratio",
  // Audio content
  topic_coverage_ratio: "Cobertura do Tema",
  personal_reference_ratio: "Referências Pessoais",
  named_entity_mentions: "Menções a Entidades",
  speaker_balance_ratio: "Equilíbrio de Falantes",
  repetition_ratio: "Repetição",
  // Image
  original_metadata_required: "Metadata Original",
  minimum_resolution: "Resolução Mínima",
  maximum_resolution: "Resolução Máxima",
  allowed_formats: "Formatos Permitidos",
  aspect_ratio: "Aspect Ratio",
  blur_detection_score: "Detecção de Blur",
  prompt_compliance: "Compliance do Prompt",
  nsfw_filter: "Filtro NSFW",
  logo_detection: "Detecção de Logo",
  // Video
  video_duration: "Duração do Vídeo",
  frame_rate: "Frame Rate",
  bitrate: "Bitrate",
  audio_track_required: "Faixa de Áudio Obrigatória",
  // Annotation
  labeling_schema_version: "Versão do Schema",
  required_fields_present: "Campos Obrigatórios",
  annotation_accuracy: "Acurácia da Anotação",
  inter_annotator_agreement: "Concordância Inter-Anotador",
  // Transcription
  timestamp_required: "Timestamp Obrigatório",
  timestamp_granularity: "Granularidade do Timestamp",
  format: "Formato",
  word_accuracy_rate: "Taxa de Acurácia de Palavras",
  punctuation_accuracy: "Acurácia de Pontuação",
  speaker_identification: "Identificação de Falante",
  // Review
  prompt_format_valid: "Formato do Prompt Válido",
  language_match_required: "Match de Idioma",
  prompt_quality_score: "Score de Qualidade",
  prompt_safety_check: "Verificação de Segurança",
  bias_detection: "Detecção de Viés",
  image_integrity: "Integridade da Imagem",
  metadata_required: "Metadata Obrigatória",
  image_label_accuracy: "Acurácia dos Labels",
  prompt_alignment: "Alinhamento do Prompt",
};

// Task type labels
export const TASK_TYPE_LABELS: Record<string, string> = {
  audio_capture_solo: "Captura de Áudio (Solo)",
  audio_capture_group: "Captura de Áudio (Grupo)",
  image_submission: "Envio de Imagens e Fotos",
  video_submission: "Envio ou Gravação de Vídeos",
  data_labeling: "Data Labelling",
  transcription: "Transcrição",
  prompt_review: "Revisão de Prompt",
  image_review: "Revisão de Imagem",
};

export const TASK_TYPE_CATEGORIES: Record<string, string> = {
  audio_capture_solo: "audio",
  audio_capture_group: "audio",
  image_submission: "image",
  video_submission: "video",
  data_labeling: "annotation",
  transcription: "text",
  prompt_review: "review",
  image_review: "review",
};
