// Campaign system types matching the new relational schema

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

export interface TaskConfig {
  id?: string;
  campaign_id?: string;
  task_type: string;
  instructions_title: string | null;
  instructions_summary: string | null;
  prompt_topic: string | null;
  prompt_do: string[];
  prompt_dont: string[];
}

export interface AdministrativeRules {
  id?: string;
  campaign_id?: string;
  max_hours_per_user: number | null;
  max_hours_per_partner_per_user: number | null;
  min_acceptance_rate: number | null;
  min_acceptance_rate_unit: string;
  max_sessions_per_user: number | null;
  min_participants_per_session: number | null;
  max_participants_per_session: number | null;
}

export interface AudioValidationRule {
  id?: string;
  campaign_id?: string;
  rule_key: string;
  min_value: number | null;
  max_value: number | null;
  target_value: number | null;
  allowed_values: any | null;
  is_critical: boolean;
}

export interface ContentValidationRule {
  id?: string;
  campaign_id?: string;
  rule_key: string;
  min_value: number | null;
  max_value: number | null;
  is_critical: boolean;
}

export interface RewardConfig {
  id?: string;
  campaign_id?: string;
  currency: string;
  payout_model: string;
  base_rate: number | null;
  bonus_rate: number | null;
  bonus_condition: string | null;
}

export interface QualityFlow {
  id?: string;
  campaign_id?: string;
  review_mode: string;
  sampling_rate_value: number | null;
  sampling_rate_unit: string;
  rejection_reasons: string[];
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
  created_at: string;
  updated_at: string;
  // Old columns (kept for backward compat)
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
  task_config?: TaskConfig | null;
  administrative_rules?: AdministrativeRules | null;
  audio_validation?: AudioValidationRule[];
  content_validation?: ContentValidationRule[];
  reward_config?: RewardConfig | null;
  quality_flow?: QualityFlow | null;
}

// Default audio validation rules template
export const DEFAULT_AUDIO_RULES: AudioValidationRule[] = [
  { rule_key: "audio_sampling_rate", target_value: 48000, allowed_values: [16000, 24000, 44100, 48000], is_critical: true, min_value: null, max_value: null },
  { rule_key: "mic_sampling_rate", min_value: 44100, is_critical: false, max_value: null, target_value: null, allowed_values: null },
  { rule_key: "rms_level", min_value: -26, max_value: -18, is_critical: true, target_value: null, allowed_values: null },
  { rule_key: "signal_to_noise_ratio", min_value: 25, is_critical: true, max_value: null, target_value: null, allowed_values: null },
  { rule_key: "srmr", min_value: 6.0, is_critical: false, max_value: null, target_value: null, allowed_values: null },
  { rule_key: "sigmos_disc", min_value: 3.5, is_critical: false, max_value: null, target_value: null, allowed_values: null },
  { rule_key: "vqscore", min_value: 3.5, is_critical: false, max_value: null, target_value: null, allowed_values: null },
  { rule_key: "wvmos", min_value: 3.5, is_critical: false, max_value: null, target_value: null, allowed_values: null },
  { rule_key: "sigmos_overall", min_value: 3.5, is_critical: false, max_value: null, target_value: null, allowed_values: null },
  { rule_key: "sigmos_reverb", max_value: 2.5, is_critical: false, min_value: null, target_value: null, allowed_values: null },
  { rule_key: "clipping_ratio", max_value: 0.01, is_critical: true, min_value: null, target_value: null, allowed_values: null },
  { rule_key: "silence_ratio", max_value: 0.25, is_critical: false, min_value: null, target_value: null, allowed_values: null },
];

export const DEFAULT_CONTENT_RULES: ContentValidationRule[] = [
  { rule_key: "topic_coverage_ratio", min_value: 0.6, is_critical: true, max_value: null },
  { rule_key: "personal_reference_ratio", min_value: 0.15, is_critical: false, max_value: null },
  { rule_key: "named_entity_mentions", max_value: 5, is_critical: false, min_value: null },
  { rule_key: "speaker_balance_ratio", min_value: 0.35, max_value: 0.65, is_critical: false },
  { rule_key: "repetition_ratio", max_value: 0.2, is_critical: false, min_value: null },
];

export const RULE_LABELS: Record<string, string> = {
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
  topic_coverage_ratio: "Cobertura do Tema",
  personal_reference_ratio: "Referências Pessoais",
  named_entity_mentions: "Menções a Entidades",
  speaker_balance_ratio: "Equilíbrio de Falantes",
  repetition_ratio: "Repetição",
};
