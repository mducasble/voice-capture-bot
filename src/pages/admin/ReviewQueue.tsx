import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock, FileAudio, Users, Play, Pause, ChevronDown,
  CheckCircle2, XCircle, User, BarChart3, ShieldCheck, ShieldX, AlertTriangle, Hourglass,
  Download, FileVolume2, Sparkles, AudioLines, Loader2, BarChart, Film, Image as ImageIcon,
} from "lucide-react";
import { MediaReviewTab } from "@/components/admin/MediaReviewTab";
import { useState, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useElevenLabsTranscription, type ElevenLabsMode } from "@/hooks/useElevenLabsTranscription";
import { useSessionTranscription } from "@/hooks/useSessionTranscription";
import { useReanalyzeAudio } from "@/hooks/useReanalyzeAudio";
import { TranscriptionCostDialog } from "@/components/TranscriptionCostDialog";
import { useEnhanceAudio } from "@/hooks/useEnhanceAudio";

// ---- types ----

interface AudioValidationRule {
  rule_key: string;
  is_critical: boolean;
  mq_threshold: number | null;
  hq_threshold: number | null;
  pq_threshold: number | null;
  task_set_id: string;
}

type QualityTier = "PQ" | "HQ" | "MQ" | "below" | null;

const TIER_CONFIG: Record<Exclude<QualityTier, null>, { label: string; color: string; bg: string }> = {
  PQ: { label: "PQ", color: "hsl(160 60% 40%)", bg: "hsl(160 60% 40% / 0.15)" },
  HQ: { label: "HQ", color: "hsl(210 70% 55%)", bg: "hsl(210 70% 55% / 0.15)" },
  MQ: { label: "MQ", color: "hsl(45 80% 50%)", bg: "hsl(45 80% 50% / 0.15)" },
  below: { label: "Abaixo", color: "hsl(0 70% 50%)", bg: "hsl(0 70% 50% / 0.15)" },
};

/** Map rule_key → recording metric value */
function getRecordingMetricValue(rec: Recording, ruleKey: string): number | null {
  const m = rec.metadata;
  switch (ruleKey) {
    case "signal_to_noise_ratio": return rec.snr_db;
    case "rms_level": return m?.rms_level_db ?? null;
    case "srmr": return m?.srmr ?? null;
    case "sigmos_disc": return m?.sigmos_disc ?? null;
    case "sigmos_overall": return m?.sigmos_ovrl ?? null;
    case "sigmos_reverb": return m?.sigmos_reverb ?? null;
    case "vqscore": return m?.vqscore ?? null;
    case "wvmos": return m?.wvmos ?? null;
    default: return null;
  }
}

/** Classify a single metric value into a tier. Higher value = better for all metrics except rms_level. */
function classifyMetricTier(
  value: number,
  ruleKey: string,
  rule: AudioValidationRule
): QualityTier {
  const { pq_threshold, hq_threshold, mq_threshold } = rule;
  
  // RMS is special: it's a range, higher (less negative) is better but within range
  // For simplicity, treat all metrics as "higher is better tier"
  // The thresholds define minimum values for each tier
  if (pq_threshold != null && value >= pq_threshold) return "PQ";
  if (hq_threshold != null && value >= hq_threshold) return "HQ";
  if (mq_threshold != null && value >= mq_threshold) return "MQ";
  
  // If no thresholds defined for this rule, skip
  if (pq_threshold == null && hq_threshold == null && mq_threshold == null) return null;
  
  return "below";
}

const TIER_RANK: Record<string, number> = { PQ: 3, HQ: 2, MQ: 1, below: 0 };

/** Classify a recording overall: worst tier among critical metrics */
function classifyRecording(rec: Recording, rules: AudioValidationRule[]): QualityTier {
  const criticalRules = rules.filter(r => r.is_critical);
  if (criticalRules.length === 0) return null;
  
  let worstTier: QualityTier = null;
  let hasAnyMetric = false;
  
  for (const rule of criticalRules) {
    if (rule.pq_threshold == null && rule.hq_threshold == null && rule.mq_threshold == null) continue;
    const value = getRecordingMetricValue(rec, rule.rule_key);
    if (value == null) continue;
    hasAnyMetric = true;
    const tier = classifyMetricTier(value, rule.rule_key, rule);
    if (tier == null) continue;
    if (worstTier == null || TIER_RANK[tier] < TIER_RANK[worstTier]) {
      worstTier = tier;
    }
  }
  
  return hasAnyMetric ? worstTier : null;
}

function QualityTierBadge({ tier }: { tier: QualityTier }) {
  if (!tier) return null;
  const config = TIER_CONFIG[tier];
  return (
    <span
      className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider font-bold shrink-0"
      style={{ background: config.bg, color: config.color }}
    >
      {config.label}
    </span>
  );
}


interface Recording {
  id: string;
  filename: string;
  duration_seconds: number | null;
  recording_type: string | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  file_url: string | null;
  mp3_file_url: string | null;
  status: string | null;
  campaign_id: string | null;
  user_id: string | null;
  quality_status: string | null;
  validation_status: string | null;
  quality_rejection_reason: string | null;
  validation_rejection_reason: string | null;
  snr_db: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  format: string | null;
  file_size_bytes: number | null;
  transcription_status: string | null;
  transcription_elevenlabs_status: string | null;
  metadata: {
    rms_level_db?: number;
    effective_bandwidth_hz?: number;
    srmr?: number;
    sigmos_sig?: number;
    sigmos_bak?: number;
    sigmos_ovrl?: number;
    sigmos_disc?: number;
    sigmos_reverb?: number;
    wvmos?: number;
    utmos?: number;
    vqscore?: number;
    mos_score?: number;
    mic_sr?: number;
    analysis_mode?: string;
    enhanced_file_url?: string;
    enhanced_snr_db?: number;
    enhanced_rms_level_db?: number;
    content_analysis?: {
      topic_adherence_percent?: number;
      off_topic_summary?: string;
      content_summary?: string;
      topic_used?: string;
      speakers?: { name: string; speaking_time_percent: number; on_topic_percent: number }[];
    };
  } | null;
  /** Runtime-only flag: true = uploaded, false = recorded in studio */
  _isUpload?: boolean;
}

interface CampaignInfo {
  id: string;
  name: string;
  description: string | null;
  campaign_type: string | null;
}

interface ProfileInfo {
  id: string;
  full_name: string | null;
  email_contact: string | null;
}

interface RoomInfo {
  id: string;
  session_id: string | null;
  topic: string | null;
  creator_name: string;
}

interface SessionGroup {
  sessionId: string;
  recordings: Recording[];
  mixed: Recording | undefined;
  individuals: Recording[];
  createdAt: string;
  topic: string | null;
  creatorName: string | null;
}

interface HostGroup {
  hostName: string;
  sessions: SessionGroup[];
  totalRecordings: number;
  pendingSessions: number;
}

const REJECTION_REASONS = [
  "Número insuficiente de participantes",
  "Áudio abaixo do padrão mínimo de qualidade",
  "Desvio do tema superior a 20%",
  "Participante infringiu as regras de produção ou envio de material",
  "Duração menor que o tempo previsto",
  "Material inconsistente (Upload de arquivos de duração diferentes)",
  "Um dos participantes já ultrapassou a cota máxima dessa campanha",
  "Participantes não enviaram áudio isolado",
  "Item de Teste",
];

// ---- helpers ----

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min ${Math.round(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

/** Color by tier: PQ = blue, HQ = green, MQ = yellow, below = red */
function tierColor(value: number | null | undefined, pq: number, hq: number, mq: number) {
  if (value == null) return "hsl(0 0% 50%)";
  if (value >= pq) return "hsl(210 80% 55%)";  // Blue (PQ)
  if (value >= hq) return "hsl(120 60% 45%)";  // Green (HQ)
  if (value >= mq) return "hsl(40 80% 50%)";   // Yellow (MQ)
  return "hsl(0 70% 50%)";                     // Red (below)
}

function snrColor(snr: number | null) {
  return tierColor(snr, 30, 25, 25); // SNR: PQ >= 30, HQ >= 25
}

function metricColor(value: number | null | undefined, pq: number, hq: number, mq: number) {
  return tierColor(value, pq, hq, mq);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function StatusPill({ status }: { status: string | null }) {
  const s = status || "pending";
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: "hsl(40 80% 50% / 0.15)", fg: "hsl(40 80% 50%)", label: "Pendente" },
    approved: { bg: "hsl(120 60% 45% / 0.15)", fg: "hsl(120 60% 45%)", label: "Aprovado" },
    rejected: { bg: "hsl(0 70% 50% / 0.15)", fg: "hsl(0 70% 50%)", label: "Rejeitado" },
  };
  const style = map[s] || map.pending;
  return (
    <span
      className="font-mono text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold"
      style={{ background: style.bg, color: style.fg }}
    >
      {style.label}
    </span>
  );
}

function getSessionStatus(recs: Recording[]) {
  const allApproved = recs.every(r => r.quality_status === "approved" && r.validation_status === "approved");
  const anyRejected = recs.some(r => r.quality_status === "rejected" || r.validation_status === "rejected");
  return allApproved ? "approved" : anyRejected ? "rejected" : "pending";
}

// ---- Track Row ----

function TrackRow({ rec, onTranscribe, validationRules, enhanceJobs }: { rec: Recording; onTranscribe?: (recId: string, sessionId: string | null, isMixed: boolean) => void; validationRules?: AudioValidationRule[]; enhanceJobs?: Record<string, string> }) {
  const [playing, setPlaying] = useState(false);
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const reanalyze = useReanalyzeAudio("sampled", "original");
  const reanalyzeEnhanced = useReanalyzeAudio("sampled", "enhanced");
  const enhance = useEnhanceAudio();
  const enhanceJobStatus = enhanceJobs?.[rec.id]; // 'pending' | 'processing' | undefined

  const toggle = useCallback(() => {
    if (!rec.file_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(rec.file_url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }, [playing, rec.file_url]);

  const m = rec.metadata;

  // Build metrics list
  const metrics: { label: string; value: string; color: string }[] = [];
  if (rec.snr_db != null) metrics.push({ label: "SNR", value: `${rec.snr_db.toFixed(1)}dB`, color: snrColor(rec.snr_db) });
  if (m?.rms_level_db != null) metrics.push({ label: "RMS", value: `${m.rms_level_db.toFixed(1)}dBFS`, color: metricColor(m.rms_level_db, -24, -26, -28) });
  if (m?.srmr != null) metrics.push({ label: "SRMR", value: m.srmr.toFixed(2), color: metricColor(m.srmr, 7, 5.4, 4) });
  if (m?.sigmos_ovrl != null) metrics.push({ label: "SigMOS Ovrl", value: m.sigmos_ovrl.toFixed(2), color: metricColor(m.sigmos_ovrl, 3.0, 2.3, 2.0) });
  if (m?.sigmos_sig != null) metrics.push({ label: "SigMOS SIG", value: m.sigmos_sig.toFixed(2), color: metricColor(m.sigmos_sig, 3.8, 3.2, 2.5) });
  if (m?.sigmos_bak != null) metrics.push({ label: "SigMOS BAK", value: m.sigmos_bak.toFixed(2), color: metricColor(m.sigmos_bak, 3.8, 3.2, 2.5) });
  if (m?.sigmos_disc != null) metrics.push({ label: "SigMOS DISC", value: m.sigmos_disc.toFixed(2), color: metricColor(m.sigmos_disc, 3.8, 3.2, 2.5) });
  if (m?.sigmos_reverb != null) metrics.push({ label: "SigMOS Rev", value: m.sigmos_reverb.toFixed(2), color: metricColor(m.sigmos_reverb, 3.8, 3.2, 2.5) });
  if (m?.wvmos != null) metrics.push({ label: "WVMOS", value: m.wvmos.toFixed(2), color: metricColor(m.wvmos, 1.8, 1.3, 1.0) });
  if (m?.utmos != null) metrics.push({ label: "UTMOS", value: m.utmos.toFixed(2), color: metricColor(m.utmos, 4.0, 3.5, 2.5) });
  if (m?.vqscore != null) metrics.push({ label: "VQScore", value: m.vqscore.toFixed(1), color: metricColor(m.vqscore, 4.5, 4, 3) });
  if (m?.mos_score != null) metrics.push({ label: "MOS", value: m.mos_score.toFixed(2), color: metricColor(m.mos_score, 4.0, 3.5, 2.5) });

  // Enhanced metrics
  const enhancedMetrics: { label: string; value: string; color: string }[] = [];
  if (m?.enhanced_snr_db != null) enhancedMetrics.push({ label: "SNR✨", value: `${m.enhanced_snr_db.toFixed(1)}dB`, color: snrColor(m.enhanced_snr_db) });
  if (m?.enhanced_rms_level_db != null) enhancedMetrics.push({ label: "RMS✨", value: `${m.enhanced_rms_level_db.toFixed(1)}dBFS`, color: metricColor(m.enhanced_rms_level_db, -22, -26, -35) });

  const hasElevenLabs = rec.transcription_elevenlabs_status === "completed";
  const isTranscribing = rec.transcription_elevenlabs_status === "processing" || rec.transcription_status === "processing";

  return (
    <div className="px-4 py-3 border-b border-border/20 space-y-2 last:border-b-0">
      {/* Row 1: play, type, name, duration */}
      <div className="flex items-center gap-3">
        {rec.file_url && (
          <button onClick={toggle} className="shrink-0 text-accent hover:text-accent/80 transition-colors">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        )}
        <span className="font-mono text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground rounded-sm shrink-0">
          {rec.recording_type === "mixed" ? "MIX" : "IND"}
        </span>
        {rec._isUpload != null && (
          <span
            className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm shrink-0 uppercase tracking-wider font-bold"
            style={{
              background: rec._isUpload ? "hsl(210 80% 50% / 0.12)" : "hsl(270 60% 50% / 0.12)",
              color: rec._isUpload ? "hsl(210 80% 55%)" : "hsl(270 60% 55%)",
            }}
          >
            {rec._isUpload ? "📤 Upload" : "🎙️ Estúdio"}
          </span>
        )}
        {validationRules && <QualityTierBadge tier={classifyRecording(rec, validationRules)} />}
        {rec.metadata?.content_analysis?.topic_adherence_percent != null && (
          <span
            className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm font-bold shrink-0"
            style={{
              background: rec.metadata.content_analysis.topic_adherence_percent >= 80
                ? "hsl(120 60% 45% / 0.15)"
                : rec.metadata.content_analysis.topic_adherence_percent >= 50
                ? "hsl(45 80% 50% / 0.15)"
                : "hsl(0 70% 50% / 0.15)",
              color: rec.metadata.content_analysis.topic_adherence_percent >= 80
                ? "hsl(120 60% 45%)"
                : rec.metadata.content_analysis.topic_adherence_percent >= 50
                ? "hsl(45 80% 50%)"
                : "hsl(0 70% 50%)",
            }}
          >
            🎯 {rec.metadata.content_analysis.topic_adherence_percent}%
          </span>
        )}
        <div className="flex-1 min-w-0">
          <span className="font-mono text-sm truncate block text-foreground">
            {rec.recording_type === "mixed" ? "Mixed" : (rec.discord_username || rec.filename)}
          </span>
        </div>
        {rec.duration_seconds != null && (
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {formatDuration(rec.duration_seconds)}
          </span>
        )}
      </div>

      {/* Row 2: file specs */}
      <div className="flex items-center gap-1.5 pl-7 flex-wrap">
        {rec.format && (
          <span className="font-mono text-[9px] px-1.5 py-0.5 bg-secondary/80 text-muted-foreground rounded-sm uppercase">
            {rec.format}
          </span>
        )}
        {rec.sample_rate && (
          <span className="font-mono text-[9px] text-muted-foreground">
            {(rec.sample_rate / 1000).toFixed(rec.sample_rate % 1000 === 0 ? 0 : 1)}kHz
          </span>
        )}
        {rec.bit_depth && (
          <span className="font-mono text-[9px] text-muted-foreground">{rec.bit_depth}bit</span>
        )}
        {rec.channels != null && (
          <span className="font-mono text-[9px] text-muted-foreground">
            {rec.channels === 1 ? "mono" : rec.channels === 2 ? "stereo" : `${rec.channels}ch`}
          </span>
        )}
        {rec.file_size_bytes != null && (
          <span className="font-mono text-[9px] text-muted-foreground">{formatBytes(rec.file_size_bytes)}</span>
        )}
        {m?.effective_bandwidth_hz != null && (
          <>
            <div className="w-px h-3 bg-border" />
            <span className="font-mono text-[9px] text-muted-foreground">
              Eff.BW {(m.effective_bandwidth_hz / 1000).toFixed(1)}kHz
            </span>
          </>
        )}
        {m?.mic_sr != null && (
          <span className="font-mono text-[9px] text-muted-foreground">
            Mic {(m.mic_sr / 1000).toFixed(1)}kHz
          </span>
        )}
        {m?.analysis_mode && (
          <>
            <div className="w-px h-3 bg-border" />
            <span className="font-mono text-[8px] px-1 py-0.5 bg-accent/10 text-accent rounded-sm uppercase">
              {m.analysis_mode}
            </span>
          </>
        )}
      </div>

      {/* Row 3: quality metrics grid */}
      {metrics.length > 0 && (
        <div className="flex items-center gap-2.5 pl-7 flex-wrap">
          {metrics.map(({ label, value, color }) => (
            <span key={label} className="font-mono text-[10px] font-bold" style={{ color }}>
              {label} {value}
            </span>
          ))}
        </div>
      )}

      {/* Row 4: enhanced metrics */}
      {enhancedMetrics.length > 0 && (
        <div className="flex items-center gap-2.5 pl-7 flex-wrap">
          <Sparkles className="h-3 w-3 text-violet-400" />
          {enhancedMetrics.map(({ label, value, color }) => (
            <span key={label} className="font-mono text-[10px] font-bold" style={{ color }}>
              {label} {value}
            </span>
          ))}
        </div>
      )}

      {/* Row 4.5: content analysis */}
      {rec.metadata?.content_analysis && (
        <div className="flex items-center gap-2.5 pl-7 flex-wrap">
          <span
            className="font-mono text-[10px] font-bold"
            style={{
              color: (rec.metadata.content_analysis.topic_adherence_percent ?? 0) >= 80
                ? "hsl(120 60% 45%)"
                : (rec.metadata.content_analysis.topic_adherence_percent ?? 0) >= 50
                ? "hsl(45 80% 50%)"
                : "hsl(0 70% 50%)",
            }}
          >
            🎯 Tema {rec.metadata.content_analysis.topic_adherence_percent}%
          </span>
          {rec.metadata.content_analysis.topic_used && (
            <span className="font-mono text-[9px] text-muted-foreground">
              ({rec.metadata.content_analysis.topic_used})
            </span>
          )}
          {rec.metadata.content_analysis.speakers && rec.metadata.content_analysis.speakers.length > 0 && (
            <>
              <div className="w-px h-3 bg-border" />
              {rec.metadata.content_analysis.speakers.map((s) => (
                <span key={s.name} className="font-mono text-[9px] text-muted-foreground">
                  🗣️ {s.name} {s.speaking_time_percent}%
                </span>
              ))}
            </>
          )}
          {rec.metadata.content_analysis.content_summary && (
            <>
              <div className="w-px h-3 bg-border" />
              <span className="font-mono text-[9px] text-muted-foreground italic truncate max-w-[300px]" title={rec.metadata.content_analysis.content_summary}>
                {rec.metadata.content_analysis.content_summary}
              </span>
            </>
          )}
        </div>
      )}


      <div className="flex items-center gap-1.5 pl-7 flex-wrap">
        {/* Download WAV */}
        {rec.file_url && (
          <a
            href={rec.file_url}
            download
            className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-secondary/80 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Download WAV (original)"
          >
            <FileAudio className="h-3 w-3" /> WAV
          </a>
        )}
        {/* Download Enhanced */}
        {m?.enhanced_file_url && (
          <a
            href={m.enhanced_file_url}
            download
            className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
            title="Download WAV (melhorado)"
          >
            <Sparkles className="h-3 w-3" /> Enhanced
          </a>
        )}
        {/* Download Compressed */}
        {rec.mp3_file_url && (
          <a
            href={rec.mp3_file_url}
            download
            className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-secondary/80 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Download comprimido (16kHz mono)"
          >
            <FileVolume2 className="h-3 w-3" /> Comprimido
          </a>
        )}

        <div className="w-px h-3 bg-border" />

        {/* Transcription status & trigger */}
        {isTranscribing && (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 text-yellow-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Transcrevendo...
          </span>
        )}
        {hasElevenLabs && (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 text-blue-400">
            <CheckCircle2 className="h-3 w-3" /> ElevenLabs ✓
          </span>
        )}
        {rec.transcription_status === "completed" && (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 text-muted-foreground">
            Gemini ✓
          </span>
        )}
        {!isTranscribing && !hasElevenLabs && onTranscribe && (
          <button
            onClick={() => setCostDialogOpen(true)}
            className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            title="Transcrever com ElevenLabs"
          >
            <AudioLines className="h-3 w-3" /> Transcrever
          </button>
        )}
        {/* Aggregate session (mixed only) */}
        {rec.recording_type === "mixed" && rec.session_id && onTranscribe && (
          <button
            onClick={() => onTranscribe(rec.id, rec.session_id, true)}
            className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            title="Agregar transcrição da sessão"
          >
            <Users className="h-3 w-3" /> Agregar Sessão
          </button>
        )}

        <div className="w-px h-3 bg-border" />

        {/* Enhance audio */}
        {rec.file_url && !m?.enhanced_file_url && (
          enhanceJobStatus ? (
            <span className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-violet-500/10 text-violet-400">
              <Loader2 className="h-3 w-3 animate-spin" /> {enhanceJobStatus === 'processing' ? 'Melhorando…' : 'Na fila'}
            </span>
          ) : (
            <button
              onClick={() => enhance.mutate({ recordingId: rec.id, fileUrl: rec.file_url! })}
              disabled={enhance.isPending}
              className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
              title="Gerar cópia enhanced (mantém original)"
            >
              {enhance.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Enhance
            </button>
          )
        )}

        {/* Reanalyze original */}
        {rec.file_url && (
          <button
            onClick={() => reanalyze.mutate(rec.id)}
            disabled={reanalyze.isPending}
            className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-secondary/80 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            title="Analisar métricas (original)"
          >
            {reanalyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart className="h-3 w-3" />} Analisar
          </button>
        )}
        {/* Reanalyze enhanced */}
        {m?.enhanced_file_url && (
          <button
            onClick={() => reanalyzeEnhanced.mutate(rec.id)}
            disabled={reanalyzeEnhanced.isPending}
            className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded-sm bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
            title="Analisar métricas (enhanced)"
          >
            {reanalyzeEnhanced.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><BarChart className="h-3 w-3" /><Sparkles className="h-2.5 w-2.5" /></>} Analisar ✨
          </button>
        )}
      </div>

      {/* Cost dialog */}
      {costDialogOpen && (
        <TranscriptionCostDialog
          open={costDialogOpen}
          onOpenChange={setCostDialogOpen}
          durationSeconds={rec.duration_seconds || 0}
          onConfirm={() => {
            setCostDialogOpen(false);
            onTranscribe?.(rec.id, rec.session_id, rec.recording_type === "mixed");
          }}
        />
      )}
    </div>
  );
}

// ---- Session block (inside a host) ----

function SessionBlock({
  session,
  profileMap,
  onApproveSession,
  onRejectSession,
  onTranscribe,
  isPending,
  validationRules,
}: {
  session: SessionGroup;
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  onTranscribe: (recId: string, sessionId: string | null, isMixed: boolean) => void;
  isPending: boolean;
  validationRules?: AudioValidationRule[];
}) {
  const [rejectionReason, setRejectionReason] = useState("");
  const recIds = session.recordings.map(r => r.id);
  const sessionStatus = getSessionStatus(session.recordings);

  const duration = session.mixed?.duration_seconds
    || Math.max(...session.individuals.map(r => r.duration_seconds || 0), 0);

  return (
    <div className="border border-border/40 rounded-md bg-card/30 overflow-hidden">
      {/* Session header */}
      <div className="px-4 py-2.5 bg-secondary/20 flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground rounded-sm">
          {session.sessionId.slice(0, 8)}
        </span>
        <StatusPill status={sessionStatus} />
        {session.topic && <span className="text-xs text-muted-foreground">· {session.topic}</span>}
        <span className="text-[10px] text-muted-foreground">
          {new Date(session.createdAt).toLocaleDateString("pt-BR")}{" "}
          {new Date(session.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <FileAudio className="h-3 w-3" /> {session.recordings.length}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Users className="h-3 w-3" /> {session.individuals.length}
          </span>
          {duration > 0 && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {formatDuration(duration)}
            </span>
          )}
        </div>
      </div>

      {/* Tracks */}
      <div>
        {session.mixed && (
          <div>
            <div className="px-4 py-1 bg-accent/5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-accent">🎧 Áudio Combinado</span>
            </div>
            <TrackRow rec={session.mixed} onTranscribe={onTranscribe} validationRules={validationRules} />
          </div>
        )}
        {session.individuals.map(r => {
          const userName = r.discord_username || (r.user_id ? profileMap.get(r.user_id) : null) || "Participante";
          return (
            <div key={r.id}>
              <div className="px-4 py-1 bg-secondary/20">
                <span className="font-mono text-[10px] text-muted-foreground">👤 {userName}</span>
              </div>
              <TrackRow rec={r} onTranscribe={onTranscribe} validationRules={validationRules} />
            </div>
          );
        })}
      </div>

      {/* Approval controls */}
      {sessionStatus === "pending" && (
        <div className="p-4 border-t border-border/30 bg-secondary/10 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-600"
              disabled={isPending}
              onClick={() => onApproveSession(recIds)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Aprovar sessão
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={rejectionReason} onValueChange={setRejectionReason}>
              <SelectTrigger className="w-full max-w-md text-xs h-8">
                <SelectValue placeholder="Selecione o motivo da rejeição..." />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASONS.map(reason => (
                  <SelectItem key={reason} value={reason} className="text-xs">{reason}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 shrink-0"
              disabled={isPending || !rejectionReason}
              onClick={() => { onRejectSession(recIds, rejectionReason); setRejectionReason(""); }}
            >
              <XCircle className="h-3.5 w-3.5" />
              Rejeitar sessão
            </Button>
          </div>
        </div>
      )}

      {sessionStatus === "rejected" && (
        <div className="p-3 border-t border-border/30 bg-destructive/5">
          <span className="font-mono text-[10px] text-destructive">
            Rejeitado: {session.recordings[0]?.quality_rejection_reason || session.recordings[0]?.validation_rejection_reason || "—"}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Host block (groups sessions by creator) ----

function HostBlock({
  host,
  profileMap,
  onApproveSession,
  onRejectSession,
  onTranscribe,
  isPending,
  validationRules,
}: {
  host: HostGroup;
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  onTranscribe: (recId: string, sessionId: string | null, isMixed: boolean) => void;
  isPending: boolean;
  validationRules?: AudioValidationRule[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/60 rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-secondary/20 transition-colors"
      >
        <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">{host.hostName}</span>
            {host.pendingSessions > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">
                {host.pendingSessions} pendente{host.pendingSessions > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {host.sessions.length} {host.sessions.length === 1 ? "sessão" : "sessões"} · {host.totalRecordings} arquivos
          </span>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/40 p-4 space-y-4">
          {host.sessions.map(session => (
            <SessionBlock
              key={session.sessionId}
              session={session}
              profileMap={profileMap}
              onApproveSession={onApproveSession}
              onRejectSession={onRejectSession}
              onTranscribe={onTranscribe}
              isPending={isPending}
              validationRules={validationRules}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Submission Summary Dashboard ----

interface CampaignStats {
  campaignName: string;
  campaignType: string | null;
  total: number;
  approved: number;
  rejected: number;
  pendingQuality: number;
  pendingValidation: number;
  goodQuality: number;
  badQuality: number;
  avgTopicAdherence: number | null;
  analyzedCount: number;
}

function SubmissionSummary({
  recordings,
  campaignMap,
}: {
  recordings: Recording[];
  campaignMap: Map<string, CampaignInfo>;
}) {
  const stats = useMemo(() => {
    const byCampaign = new Map<string, Recording[]>();
    for (const r of recordings) {
      const key = r.campaign_id || "__none__";
      if (!byCampaign.has(key)) byCampaign.set(key, []);
      byCampaign.get(key)!.push(r);
    }

    const result: CampaignStats[] = [];
    for (const [cid, recs] of byCampaign) {
      const campaign = cid !== "__none__" ? campaignMap.get(cid) : null;
      const approved = recs.filter(r => r.quality_status === "approved" && r.validation_status === "approved").length;
      const rejected = recs.filter(r => r.quality_status === "rejected" || r.validation_status === "rejected").length;
      const pendingQuality = recs.filter(r => r.quality_status === "pending" || !r.quality_status).length;
      const pendingValidation = recs.filter(r => r.quality_status === "approved" && (r.validation_status === "pending" || !r.validation_status)).length;
      const goodQuality = recs.filter(r => {
        const snr = r.snr_db;
        const ovrl = r.metadata?.sigmos_ovrl;
        return (snr != null && snr >= 25) || (ovrl != null && ovrl >= 3.5);
      }).length;
      const badQuality = recs.filter(r => {
        const snr = r.snr_db;
        const ovrl = r.metadata?.sigmos_ovrl;
        return (snr != null && snr < 15) || (ovrl != null && ovrl < 2.5);
      }).length;

      // Topic adherence
      const analyzedRecs = recs.filter(r => r.metadata?.content_analysis?.topic_adherence_percent != null);
      const avgTopicAdherence = analyzedRecs.length > 0
        ? Math.round(analyzedRecs.reduce((a, r) => a + (r.metadata!.content_analysis!.topic_adherence_percent!), 0) / analyzedRecs.length)
        : null;

      result.push({
        campaignName: campaign?.name || "Sem campanha",
        campaignType: campaign?.campaign_type || null,
        total: recs.length,
        approved,
        rejected,
        pendingQuality,
        pendingValidation,
        goodQuality,
        badQuality,
        avgTopicAdherence,
        analyzedCount: analyzedRecs.length,
      });
    }
    result.sort((a, b) => b.total - a.total);
    return result;
  }, [recordings, campaignMap]);

  const totals = useMemo(() => ({
    total: stats.reduce((a, s) => a + s.total, 0),
    approved: stats.reduce((a, s) => a + s.approved, 0),
    rejected: stats.reduce((a, s) => a + s.rejected, 0),
    pendingQuality: stats.reduce((a, s) => a + s.pendingQuality, 0),
    pendingValidation: stats.reduce((a, s) => a + s.pendingValidation, 0),
    goodQuality: stats.reduce((a, s) => a + s.goodQuality, 0),
    badQuality: stats.reduce((a, s) => a + s.badQuality, 0),
  }), [stats]);

  return (
    <Card className="border-border/40 bg-card">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Resumo de Materiais
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {/* Global counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <SummaryPill icon={FileAudio} label="Total" value={totals.total} color="text-foreground" />
          <SummaryPill icon={CheckCircle2} label="Aprovados" value={totals.approved} color="text-green-500" />
          <SummaryPill icon={XCircle} label="Rejeitados" value={totals.rejected} color="text-destructive" />
          <SummaryPill icon={Hourglass} label="Pend. Qualidade" value={totals.pendingQuality} color="text-amber-500" />
          <SummaryPill icon={AlertTriangle} label="Pend. Validação" value={totals.pendingValidation} color="text-orange-400" />
          <SummaryPill icon={ShieldCheck} label="Boa Qualidade" value={totals.goodQuality} color="text-emerald-500" />
          <SummaryPill icon={ShieldX} label="Baixa Qualidade" value={totals.badQuality} color="text-red-400" />
        </div>

        {/* Per-campaign table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left py-2 text-muted-foreground font-medium">Campanha</th>
                <th className="text-left py-2 text-muted-foreground font-medium">Tipo</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Total</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Aprovados</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Rejeitados</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Pend. QA</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Pend. VAL</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Boa Qual.</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Baixa Qual.</th>
                <th className="text-right py-2 text-muted-foreground font-medium">🎯 Tema</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={i} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                  <td className="py-2 font-medium text-foreground truncate max-w-[200px]">{s.campaignName}</td>
                  <td className="py-2 text-muted-foreground">
                    {s.campaignType && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 bg-secondary rounded-sm uppercase">
                        {s.campaignType.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right font-bold text-foreground">{s.total}</td>
                  <td className="py-2 text-right font-bold text-green-500">{s.approved}</td>
                  <td className="py-2 text-right font-bold text-destructive">{s.rejected}</td>
                  <td className="py-2 text-right font-bold text-amber-500">{s.pendingQuality}</td>
                  <td className="py-2 text-right font-bold text-orange-400">{s.pendingValidation}</td>
                  <td className="py-2 text-right font-bold text-emerald-500">{s.goodQuality}</td>
                  <td className="py-2 text-right font-bold text-red-400">{s.badQuality}</td>
                  <td className="py-2 text-right font-bold" style={{
                    color: s.avgTopicAdherence != null
                      ? s.avgTopicAdherence >= 80 ? "hsl(120 60% 45%)" : s.avgTopicAdherence >= 50 ? "hsl(45 80% 50%)" : "hsl(0 70% 50%)"
                      : undefined
                  }}>
                    {s.avgTopicAdherence != null ? `${s.avgTopicAdherence}%` : "—"}
                    {s.analyzedCount > 0 && (
                      <span className="text-[8px] text-muted-foreground ml-0.5">({s.analyzedCount})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary/50 border border-border/30">
      <Icon className={`h-4 w-4 ${color} opacity-70 shrink-0`} />
      <div className="min-w-0">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
        <p className={`text-lg font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

// ---- Status filter type ----
type StatusFilter = "pending" | "approved" | "rejected";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string; icon: React.ElementType; color: string }[] = [
  { value: "pending", label: "Não processados", icon: Hourglass, color: "text-amber-500" },
  { value: "approved", label: "Aprovados", icon: CheckCircle2, color: "text-green-500" },
  { value: "rejected", label: "Rejeitados", icon: XCircle, color: "text-destructive" },
];

// ---- Campaign tab content ----

function CampaignTabContent({
  hosts,
  profileMap,
  onApproveSession,
  onRejectSession,
  onTranscribe,
  isPending,
  validationRules,
}: {
  hosts: HostGroup[];
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  onTranscribe: (recId: string, sessionId: string | null, isMixed: boolean) => void;
  isPending: boolean;
  validationRules?: AudioValidationRule[];
}) {
  const [filter, setFilter] = useState<StatusFilter>("pending");

  // Filter hosts → sessions by status
  const filteredHosts = useMemo(() => {
    const result: HostGroup[] = [];
    for (const host of hosts) {
      const filteredSessions = host.sessions.filter(s => getSessionStatus(s.recordings) === filter);
      if (filteredSessions.length > 0) {
        result.push({
          ...host,
          sessions: filteredSessions,
          totalRecordings: filteredSessions.reduce((a, s) => a + s.recordings.length, 0),
          pendingSessions: filteredSessions.filter(s => getSessionStatus(s.recordings) === "pending").length,
        });
      }
    }
    return result;
  }, [hosts, filter]);

  // Count per filter for badges
  const counts = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0;
    for (const host of hosts) {
      for (const s of host.sessions) {
        const st = getSessionStatus(s.recordings);
        if (st === "pending") pending++;
        else if (st === "approved") approved++;
        else if (st === "rejected") rejected++;
      }
    }
    return { pending, approved, rejected };
  }, [hosts]);

  if (hosts.length === 0) {
    return (
      <div className="text-center py-12 border border-border bg-card rounded-lg">
        <FileAudio className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhuma sessão nesta campanha.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTER_OPTIONS.map(opt => {
          const count = counts[opt.value];
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors font-medium ${
                isActive
                  ? "bg-secondary border-border text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              <opt.icon className={`h-3.5 w-3.5 ${isActive ? opt.color : ""}`} />
              {opt.label}
              {count > 0 && (
                <span className={`font-mono text-[10px] px-1.5 py-0 rounded-full ${
                  isActive ? `${opt.color} bg-background` : "text-muted-foreground bg-secondary/60"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filtered content */}
      {filteredHosts.length === 0 ? (
        <div className="text-center py-10 border border-border/40 bg-card/50 rounded-lg">
          <p className="text-sm text-muted-foreground">
            Nenhuma sessão {filter === "pending" ? "pendente" : filter === "approved" ? "aprovada" : "rejeitada"}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHosts.map(host => (
            <HostBlock
              key={host.hostName}
              host={host}
              profileMap={profileMap}
              onApproveSession={onApproveSession}
              onRejectSession={onRejectSession}
              onTranscribe={onTranscribe}
              isPending={isPending}
              validationRules={validationRules}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main page ----

export default function ReviewQueue() {
  const queryClient = useQueryClient();

  const { data: recordings, isLoading } = useQuery({
    queryKey: ["admin_review_queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voice_recordings")
        .select("id, filename, duration_seconds, recording_type, session_id, created_at, discord_username, file_url, mp3_file_url, status, campaign_id, user_id, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, snr_db, sample_rate, bit_depth, channels, format, file_size_bytes, transcription_status, transcription_elevenlabs_status, metadata")
        .not("session_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Recording[];
    },
  });

  const campaignIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.campaign_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: campaigns } = useQuery({
    queryKey: ["admin_review_campaigns", campaignIds],
    queryFn: async () => {
      if (!campaignIds.length) return [];
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, description, campaign_type")
        .in("id", campaignIds);
      if (error) throw error;
      return (data || []) as CampaignInfo[];
    },
    enabled: campaignIds.length > 0,
  });

  const userIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.user_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: profiles } = useQuery({
    queryKey: ["admin_review_profiles", userIds],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email_contact")
        .in("id", userIds);
      if (error) throw error;
      return (data || []) as ProfileInfo[];
    },
    enabled: userIds.length > 0,
  });

  const sessionIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.session_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: rooms } = useQuery({
    queryKey: ["admin_review_rooms", sessionIds],
    queryFn: async () => {
      if (!sessionIds.length) return [];
      const { data, error } = await supabase
        .from("rooms")
        .select("id, session_id, topic, creator_name")
        .in("session_id", sessionIds);
      if (error) throw error;
      return (data || []) as RoomInfo[];
    },
    enabled: sessionIds.length > 0,
  });

  // Fetch audio validation rules (critical, with thresholds) per campaign
  const { data: audioValidationRules } = useQuery({
    queryKey: ["admin_review_audio_validation", campaignIds],
    queryFn: async () => {
      if (!campaignIds.length) return [];
      const { data, error } = await supabase
        .from("campaign_audio_validation")
        .select("rule_key, is_critical, mq_threshold, hq_threshold, pq_threshold, task_set_id, campaign_id")
        .in("campaign_id", campaignIds)
        .eq("is_critical", true);
      if (error) throw error;
      return (data || []) as (AudioValidationRule & { campaign_id: string })[];
    },
    enabled: campaignIds.length > 0,
  });

  const validationRulesMap = useMemo(() => {
    const m = new Map<string, AudioValidationRule[]>();
    audioValidationRules?.forEach(r => {
      const cid = (r as any).campaign_id as string;
      if (!m.has(cid)) m.set(cid, []);
      m.get(cid)!.push(r);
    });
    return m;
  }, [audioValidationRules]);

  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    profiles?.forEach(p => m.set(p.id, p.full_name || p.email_contact || p.id.slice(0, 8)));
    return m;
  }, [profiles]);

  const campaignMap = useMemo(() => {
    const m = new Map<string, CampaignInfo>();
    campaigns?.forEach(c => m.set(c.id, c));
    return m;
  }, [campaigns]);

  const roomMap = useMemo(() => {
    const m = new Map<string, RoomInfo>();
    rooms?.forEach(r => { if (r.session_id) m.set(r.session_id, r); });
    return m;
  }, [rooms]);

  // Build: campaign → hosts → sessions → recordings
  const { campaignTabs, noCampaignHosts } = useMemo(() => {
    if (!recordings) return { campaignTabs: [], noCampaignHosts: [] };

    const byCampaign = new Map<string, Map<string, Recording[]>>();
    const noCampaignMap = new Map<string, Recording[]>();

    for (const r of recordings) {
      const sid = r.session_id || r.id;
      if (!r.campaign_id) {
        if (!noCampaignMap.has(sid)) noCampaignMap.set(sid, []);
        noCampaignMap.get(sid)!.push(r);
      } else {
        if (!byCampaign.has(r.campaign_id)) byCampaign.set(r.campaign_id, new Map());
        const sessionMap = byCampaign.get(r.campaign_id)!;
        if (!sessionMap.has(sid)) sessionMap.set(sid, []);
        sessionMap.get(sid)!.push(r);
      }
    }

    const buildSessions = (sessionMap: Map<string, Recording[]>): SessionGroup[] => {
      const sessions: SessionGroup[] = [];
      for (const [sid, recs] of sessionMap) {
        // Tag each recording with origin: upload vs studio
        const hasRoom = roomMap.has(sid);
        for (const r of recs) {
          r._isUpload = !hasRoom;
        }

        const mixed = recs.find(r => r.recording_type === "mixed");
        const individuals = recs.filter(r => r.recording_type !== "mixed");
        const room = roomMap.get(sid);
        // Fallback: resolve uploader name from profile (user_id), then discord_username
        const uploaderRec = recs.find(r => r.user_id) || recs[0];
        const fallbackName = (uploaderRec?.user_id ? profileMap.get(uploaderRec.user_id) : null)
          || recs.find(r => r.discord_username && r.discord_username !== "Multi-Speaker Session")?.discord_username
          || null;
        sessions.push({
          sessionId: sid,
          recordings: recs,
          mixed,
          individuals,
          createdAt: recs[0].created_at,
          topic: room?.topic || null,
          creatorName: room?.creator_name || fallbackName,
        });
      }
      sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return sessions;
    };

    const groupByHost = (sessions: SessionGroup[]): HostGroup[] => {
      const byHost = new Map<string, SessionGroup[]>();
      for (const s of sessions) {
        const hostName = s.creatorName || "Desconhecido";
        if (!byHost.has(hostName)) byHost.set(hostName, []);
        byHost.get(hostName)!.push(s);
      }
      const hosts: HostGroup[] = [];
      for (const [hostName, hostSessions] of byHost) {
        const pendingSessions = hostSessions.filter(s => getSessionStatus(s.recordings) === "pending").length;
        hosts.push({
          hostName,
          sessions: hostSessions,
          totalRecordings: hostSessions.reduce((a, s) => a + s.recordings.length, 0),
          pendingSessions,
        });
      }
      hosts.sort((a, b) => b.pendingSessions - a.pendingSessions);
      return hosts;
    };

    const tabs: { campaign: CampaignInfo; hosts: HostGroup[]; pendingCount: number }[] = [];
    for (const [cid, sessionMap] of byCampaign) {
      const campaign = campaignMap.get(cid) || { id: cid, name: cid.slice(0, 8), description: null, campaign_type: null };
      const sessions = buildSessions(sessionMap);
      const hosts = groupByHost(sessions);
      const pendingCount = sessions.filter(s => getSessionStatus(s.recordings) === "pending").length;
      tabs.push({ campaign, hosts, pendingCount });
    }
    tabs.sort((a, b) => b.pendingCount - a.pendingCount);

    return {
      campaignTabs: tabs,
      noCampaignHosts: groupByHost(buildSessions(noCampaignMap)),
    };
  }, [recordings, campaignMap, roomMap, profileMap]);

  // Mutations
  const approveSessionMutation = useMutation({
    mutationFn: async ({ recordingIds }: { recordingIds: string[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      for (const id of recordingIds) {
        const { error } = await supabase
          .from("voice_recordings")
          .update({
            quality_status: "approved",
            validation_status: "approved",
            quality_reviewed_at: now,
            validation_reviewed_at: now,
            quality_reviewed_by: user?.id || null,
            validation_reviewed_by: user?.id || null,
          } as any)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_review_queue"] });
      toast.success("Sessão aprovada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao aprovar"),
  });

  const rejectSessionMutation = useMutation({
    mutationFn: async ({ recordingIds, reason }: { recordingIds: string[]; reason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      for (const id of recordingIds) {
        const { error } = await supabase
          .from("voice_recordings")
          .update({
            quality_status: "rejected",
            validation_status: "rejected",
            quality_rejection_reason: reason,
            validation_rejection_reason: reason,
            quality_reviewed_at: now,
            validation_reviewed_at: now,
            quality_reviewed_by: user?.id || null,
            validation_reviewed_by: user?.id || null,
          } as any)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_review_queue"] });
      toast.success("Sessão rejeitada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao rejeitar"),
  });

  const handleApproveSession = (recordingIds: string[]) => approveSessionMutation.mutate({ recordingIds });
  const handleRejectSession = (recordingIds: string[], reason: string) => rejectSessionMutation.mutate({ recordingIds, reason });
  const isMutating = approveSessionMutation.isPending || rejectSessionMutation.isPending;

  // Transcription hooks
  const elevenLabsTranscription = useElevenLabsTranscription();
  const sessionTranscription = useSessionTranscription();

  const handleTranscribe = useCallback((recId: string, sessionId: string | null, isMixed: boolean) => {
    if (isMixed && sessionId) {
      sessionTranscription.mutate({ sessionId, mixedRecordingId: recId });
    } else {
      elevenLabsTranscription.mutate({ recordingId: recId, mode: "chunks" });
    }
  }, [elevenLabsTranscription, sessionTranscription]);

  const hasNoCampaign = noCampaignHosts.length > 0;
  const allTabs = campaignTabs;
  const defaultTab = allTabs.length > 0 ? allTabs[0].campaign.id : (hasNoCampaign ? "__none__" : "");

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Fila de Aprovação</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Revisão de submissões por tipo de mídia.
        </p>
      </div>

      {/* Top-level type tabs */}
      <Tabs defaultValue="audio" className="w-full">
        <TabsList className="w-auto gap-1 bg-secondary/50 p-1">
          <TabsTrigger value="audio" className="text-sm px-4 py-2 gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <FileAudio className="h-4 w-4" />
            Áudio
          </TabsTrigger>
          <TabsTrigger value="video" className="text-sm px-4 py-2 gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Film className="h-4 w-4" />
            Vídeo
          </TabsTrigger>
          <TabsTrigger value="image" className="text-sm px-4 py-2 gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <ImageIcon className="h-4 w-4" />
            Imagem
          </TabsTrigger>
        </TabsList>

        {/* AUDIO TAB — existing content */}
        <TabsContent value="audio" className="mt-5 space-y-6">
          {!isLoading && recordings && recordings.length > 0 && (
            <SubmissionSummary recordings={recordings} campaignMap={campaignMap} />
          )}

          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          )}

          {!isLoading && allTabs.length === 0 && !hasNoCampaign && (
            <div className="text-center py-16 border border-border bg-card rounded-lg">
              <FileAudio className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground">Nenhuma sessão encontrada</h3>
              <p className="text-sm text-muted-foreground mt-1">As sessões enviadas pelo portal aparecerão aqui.</p>
            </div>
          )}

          {!isLoading && (allTabs.length > 0 || hasNoCampaign) && (
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="w-full flex-wrap h-auto gap-1.5 bg-secondary/50 p-1.5">
                {allTabs.map(({ campaign, pendingCount }) => (
                  <TabsTrigger
                    key={campaign.id}
                    value={campaign.id}
                    className="text-sm px-4 py-2 gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <span className="truncate max-w-[160px]">{campaign.name}</span>
                    {pendingCount > 0 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/40 text-amber-500">
                        {pendingCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
                {hasNoCampaign && (
                  <TabsTrigger
                    value="__none__"
                    className="text-sm px-4 py-2 gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm text-muted-foreground"
                  >
                    Sem campanha
                  </TabsTrigger>
                )}
              </TabsList>

              {allTabs.map(({ campaign, hosts }) => (
                <TabsContent key={campaign.id} value={campaign.id} className="mt-5">
                  <div className="mb-4">
                    <h2 className="text-base font-bold text-foreground">{campaign.name}</h2>
                    {campaign.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{campaign.description}</p>
                    )}
                  </div>
                  <CampaignTabContent
                    hosts={hosts}
                    profileMap={profileMap}
                    onApproveSession={handleApproveSession}
                    onRejectSession={handleRejectSession}
                    onTranscribe={handleTranscribe}
                    isPending={isMutating}
                    validationRules={validationRulesMap.get(campaign.id)}
                  />
                </TabsContent>
              ))}

              {hasNoCampaign && (
                <TabsContent value="__none__" className="mt-5">
                  <div className="mb-4">
                    <h2 className="text-base font-bold text-foreground">Sem campanha</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Gravações legadas sem vínculo de campanha.</p>
                  </div>
                  <CampaignTabContent
                    hosts={noCampaignHosts}
                    profileMap={profileMap}
                    onApproveSession={handleApproveSession}
                    onRejectSession={handleRejectSession}
                    onTranscribe={handleTranscribe}
                    isPending={isMutating}
                  />
                </TabsContent>
              )}
            </Tabs>
          )}
        </TabsContent>

        {/* VIDEO TAB */}
        <TabsContent value="video" className="mt-5">
          <MediaReviewTab mediaType="video" />
        </TabsContent>

        {/* IMAGE TAB */}
        <TabsContent value="image" className="mt-5">
          <MediaReviewTab mediaType="image" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
