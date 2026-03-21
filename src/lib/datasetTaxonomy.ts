// ─── Dataset Taxonomy Enums ───────────────────────────────────────────

export const ASSET_STAGES = [
  "raw_pool", "validated_pool", "labeled_pool", "curated_pool",
  "benchmark_pool", "eval_pool", "archived_pool",
] as const;

export const DATASET_STATUSES = [
  "draft", "active", "frozen", "deprecated", "archived",
] as const;

export const VERSION_STATUSES = [
  "draft", "review", "active", "frozen", "deprecated",
] as const;

export const SNAPSHOT_TYPES = [
  "dynamic_reference", "frozen_snapshot",
] as const;

export const MODALITIES = [
  "audio", "video", "image", "text", "multimodal", "mixed",
] as const;

export const TASK_FAMILIES = [
  "speech", "vision", "multimodal_understanding", "multimodal_generation",
  "editing", "quality_assessment", "behavior_understanding",
  "evaluation_only", "synthetic_data",
] as const;

export const TASK_TYPES = [
  "speech_recognition", "speaker_diarization", "speaker_verification",
  "keyword_spotting", "audio_classification", "audio_quality_assessment",
  "talking_head", "action_recognition", "gesture_tracking",
  "pose_estimation", "object_detection", "segmentation",
  "image_classification", "captioning", "visual_question_answering",
  "video_captioning", "video_editing_pairs", "image_editing_pairs",
  "reference_based_editing", "retrieval", "ranking",
  "safety_evaluation", "model_evaluation_benchmark",
] as const;

export const SOURCE_TYPES = [
  "first_party_direct_collection", "partner_collection",
  "user_generated", "licensed_third_party", "synthetic",
  "synthetic_assisted", "derived_from_existing_dataset",
] as const;

export const CONSENT_STATUSES = [
  "valid", "missing", "expired", "revoked", "restricted", "pending_review",
] as const;

export const LEGAL_REVIEW_STATUSES = [
  "approved", "rejected", "pending", "not_required",
] as const;

export const ANNOTATION_STATUSES = [
  "none", "partial", "complete", "needs_review", "rejected",
] as const;

export const QC_STATUSES = [
  "pending", "pass", "conditional_pass", "fail", "needs_manual_review",
] as const;

export const SPLITS = [
  "train", "validation", "test", "benchmark", "eval", "red_team", "edge_case",
] as const;

export const POLICY_PROFILES = [
  "internal_research_generic", "commercial_training_standard",
  "benchmark_strict", "sensitive_biometric_restricted",
  "partner_restricted_dataset",
] as const;

// ─── Profile Dimensions ──────────────────────────────────────────────

export const VIDEO_PROFILE_DIMENSIONS: Record<string, string[]> = {
  resolution_bucket: ["below_720p", "720p", "1080p", "1440p", "4k_plus"],
  fps_bucket: ["below_24", "24", "25", "30", "50", "60_plus"],
  orientation: ["portrait", "landscape", "square", "mixed"],
  camera_motion: ["static", "low_motion", "moderate_motion", "high_motion", "erratic_motion"],
  lighting_condition: ["very_low_light", "low_light", "normal", "bright", "overexposed", "mixed_lighting"],
  blur_level: ["none", "mild", "moderate", "severe"],
  occlusion_level: ["none", "mild", "moderate", "severe"],
  scene_type: ["indoor", "outdoor", "vehicle", "public_space", "home", "office", "retail", "mixed"],
  shot_type: ["selfie", "third_person", "egocentric", "tabletop", "screen_capture", "mixed"],
  subject_visibility: ["full_body", "upper_body", "face_only", "hands_only", "object_only", "no_primary_subject"],
};

export const AUDIO_PROFILE_DIMENSIONS: Record<string, string[]> = {
  sample_rate_bucket: ["below_16khz", "16khz", "22khz", "44_1khz", "48khz", "above_48khz"],
  channel_type: ["mono", "stereo", "multi_channel"],
  loudness_level: ["too_low", "low", "acceptable", "high", "clipping_risk"],
  snr_tier: ["very_poor", "poor", "acceptable", "good", "excellent"],
  reverberation_tier: ["low", "moderate", "high", "severe"],
  background_noise_type: ["quiet", "household", "street", "office", "crowd", "tv_media", "vehicle", "wind", "mixed"],
  speech_clarity: ["poor", "acceptable", "good", "excellent"],
  overlap_level: ["none", "low", "moderate", "high"],
  microphone_type: ["phone_builtin", "headset", "lavalier", "usb_mic", "studio_mic", "unknown"],
  speech_style: ["scripted", "read_speech", "spontaneous", "conversational", "emotional", "command_based"],
};

export const IMAGE_PROFILE_DIMENSIONS: Record<string, string[]> = {
  content_type: ["portrait", "document", "product", "scene", "screenshot", "ui", "object_closeup", "mixed"],
  capture_type: ["camera_photo", "scan", "screenshot", "rendered", "synthetic"],
};

export const TEXT_PROFILE_DIMENSIONS: Record<string, string[]> = {
  domain: ["general", "customer_support", "gaming", "medical", "legal", "finance", "education", "coding", "social", "mixed"],
  style: ["formal", "informal", "chat", "instructional", "persuasive", "narrative", "technical"],
  safety_sensitivity: ["low", "moderate", "high", "restricted"],
  task_structure: ["single_turn", "multi_turn", "classification", "extraction", "rewrite", "summarization", "reasoning", "tool_use", "evaluation"],
  response_grounding: ["none", "document_grounded", "image_grounded", "audio_grounded", "multimodal_grounded"],
};

// ─── Labels ──────────────────────────────────────────────────────────

export function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Plus$/i, "+")
    .replace(/Khz/gi, "kHz");
}

export const DATASET_STATUS_STYLE: Record<string, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  active: { label: "Ativo", className: "bg-emerald-500/20 text-emerald-400" },
  frozen: { label: "Congelado", className: "bg-sky-500/20 text-sky-400" },
  deprecated: { label: "Depreciado", className: "bg-orange-500/20 text-orange-400" },
  archived: { label: "Arquivado", className: "bg-yellow-500/20 text-yellow-400" },
};
