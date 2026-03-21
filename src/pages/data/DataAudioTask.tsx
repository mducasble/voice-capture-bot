import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, XCircle, ArrowLeft, Clock,
  SkipForward, Mic2, User, Globe, Headphones,
  Archive, Flag, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RejectionReasonModal } from "@/components/audit/RejectionReasonModal";
import { FlagReasonModal } from "@/components/data/FlagReasonModal";
import { TrackFlagReasonModal } from "@/components/data/TrackFlagReasonModal";
import { TrackCard } from "@/components/data/TrackCard";
import { SpeakerSelectDialog } from "@/components/data/SpeakerSelectDialog";
import { cn } from "@/lib/utils";

interface Recording {
  id: string;
  filename: string;
  file_url: string | null;
  duration_seconds: number | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  quality_status: string | null;
  recording_type: string | null;
  metadata: any;
  snr_db: number | null;
  campaign_id: string | null;
  user_id: string | null;
}

type ActionEvent = { action: string; timestamp: string; detail?: string };

const tierColors: Record<string, string> = {
  PQ: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  HQ: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  MQ: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  LQ: "bg-red-500/20 text-red-400 border-red-500/30",
};

const tierLabels: Record<string, string> = {
  PQ: "Premium Quality", HQ: "High Quality", MQ: "Medium Quality", LQ: "Low Quality",
};

const metricTooltips: Record<string, string> = {
  snr_db: "Relação sinal-ruído. Quanto maior, menos ruído de fundo.",
  sigmos_ovrl: "Qualidade perceptual geral do áudio (escala 1-5).",
  srmr: "Taxa de modulação do reverberação.",
  rms_dbfs: "Nível médio de volume em decibéis.",
  wvmos: "Qualidade de fala estimada (escala 1-5).",
  vqscore: "Pontuação de qualidade vetorial (0-1).",
  sigmos_reverb: "Componente de reverberação na análise SigMOS.",
  sigmos_disc: "Componente de distorção/descontinuidade.",
};

function deriveTierForMetric(key: string, v: number): "PQ" | "HQ" | "MQ" | "LQ" {
  switch (key) {
    case "snr_db": return v >= 30 ? "PQ" : v >= 25 ? "HQ" : v >= 18 ? "MQ" : "LQ";
    case "sigmos_ovrl": return v >= 3.0 ? "PQ" : v >= 2.3 ? "HQ" : v >= 2.0 ? "MQ" : "LQ";
    case "srmr": return v >= 7.0 ? "PQ" : v >= 5.4 ? "HQ" : v >= 4.0 ? "MQ" : "LQ";
    case "rms_dbfs": return v >= -24 ? "PQ" : v >= -26 ? "HQ" : v >= -28 ? "MQ" : "LQ";
    case "wvmos": return v >= 3.5 ? "PQ" : v >= 2.5 ? "HQ" : v >= 2.0 ? "MQ" : "LQ";
    case "vqscore": return v >= 0.65 ? "PQ" : v >= 0.5 ? "HQ" : v >= 0.35 ? "MQ" : "LQ";
    case "sigmos_reverb": return v >= 3.5 ? "PQ" : v >= 2.5 ? "HQ" : v >= 2.0 ? "MQ" : "LQ";
    case "sigmos_disc": return v >= 3.5 ? "PQ" : v >= 2.5 ? "HQ" : v >= 2.0 ? "MQ" : "LQ";
    default: return "MQ";
  }
}

const TIER_ORDER: Record<string, number> = { LQ: 0, MQ: 1, HQ: 2, PQ: 3 };
const TIER_FROM_ORDER = ["LQ", "MQ", "HQ", "PQ"];

function getOriginalSnr(sib: any) {
  const meta = sib.metadata || {};
  return sib.snr_db ?? meta.snr_db ?? meta.quality_metrics?.snr_db ?? null;
}

function deriveTier(sib: any): string | undefined {
  const meta = sib.metadata || {};
  const stored = typeof meta.quality_tier === "string" ? meta.quality_tier.toUpperCase() : undefined;
  if (stored) return stored;

  const metrics: [string, number | null | undefined][] = [
    ["snr_db", getOriginalSnr(sib)],
    ["sigmos_ovrl", meta.sigmos_ovrl],
    ["srmr", meta.srmr],
    ["rms_dbfs", meta.rms_dbfs],
    ["wvmos", meta.wvmos],
    ["vqscore", meta.vqscore],
    ["sigmos_reverb", meta.sigmos_reverb],
    ["sigmos_disc", meta.sigmos_disc],
  ];

  let minOrder = 3;
  let hasAny = false;
  for (const [key, val] of metrics) {
    if (val == null) continue;
    hasAny = true;
    const tier = deriveTierForMetric(key, Number(val));
    const order = TIER_ORDER[tier] ?? 1;
    if (order < minOrder) minOrder = order;
  }
  if (!hasAny) return undefined;
  return TIER_FROM_ORDER[minOrder];
}

function getTrackMetrics(sib: any) {
  const meta = sib.metadata || {};
  return [
    { key: "snr_db", label: "SNR", unit: "dB", val: getOriginalSnr(sib) },
    { key: "sigmos_ovrl", label: "SigMOS Overall", val: meta.sigmos_ovrl },
    { key: "srmr", label: "SRMR", val: meta.srmr },
    { key: "rms_dbfs", label: "RMS Level", unit: "dBFS", val: meta.rms_dbfs },
    { key: "wvmos", label: "WVMOS", val: meta.wvmos },
    { key: "vqscore", label: "VQScore", val: meta.vqscore },
    { key: "sigmos_reverb", label: "SigMOS Reverb", val: meta.sigmos_reverb },
    { key: "sigmos_disc", label: "SigMOS Disc", val: meta.sigmos_disc },
  ].filter((m) => m.val != null);
}

function getEnhancedMetrics(sib: any) {
  const meta = sib.metadata || {};
  const em = meta.enhanced_metrics;
  if (!em) return [];
  return [
    { key: "snr_db", label: "SNR", unit: "dB", val: em.snr_db },
    { key: "sigmos_ovrl", label: "SigMOS Overall", val: em.sigmos_ovrl },
    { key: "srmr", label: "SRMR", val: em.srmr },
    { key: "rms_dbfs", label: "RMS Level", unit: "dBFS", val: em.rms_dbfs },
    { key: "wvmos", label: "WVMOS", val: em.wvmos },
    { key: "vqscore", label: "VQScore", val: em.vqscore },
    { key: "sigmos_reverb", label: "SigMOS Reverb", val: em.sigmos_reverb },
    { key: "sigmos_disc", label: "SigMOS Disc", val: em.sigmos_disc },
  ].filter((m) => m.val != null);
}

function deriveEnhancedTier(sib: any): string | undefined {
  const meta = sib.metadata || {};
  const stored = typeof meta.enhanced_quality_tier === "string" ? meta.enhanced_quality_tier.toUpperCase() : undefined;
  if (stored) return stored;
  const em = meta.enhanced_metrics;
  if (!em) return undefined;
  const metrics: [string, number | null | undefined][] = [
    ["snr_db", em.snr_db],
    ["sigmos_ovrl", em.sigmos_ovrl],
    ["srmr", em.srmr],
    ["rms_dbfs", em.rms_dbfs],
    ["wvmos", em.wvmos],
    ["vqscore", em.vqscore],
    ["sigmos_reverb", em.sigmos_reverb],
    ["sigmos_disc", em.sigmos_disc],
  ];
  let minOrder = 3;
  let hasAny = false;
  for (const [key, val] of metrics) {
    if (val == null) continue;
    hasAny = true;
    const tier = deriveTierForMetric(key, Number(val));
    const order = TIER_ORDER[tier] ?? 1;
    if (order < minOrder) minOrder = order;
  }
  if (!hasAny) return undefined;
  return TIER_FROM_ORDER[minOrder];
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export default function DataAudioTask() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rec, setRec] = useState<Recording | null>(null);
  const [siblings, setSiblings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [taskTypeLabel, setTaskTypeLabel] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timeLimit, setTimeLimit] = useState(300);
  const [trackedActions, setTrackedActions] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [taskLogId, setTaskLogId] = useState<string | null>(null);
  const [taskSetId, setTaskSetId] = useState<string | null>(null);
  const [queuedJobs, setQueuedJobs] = useState<Record<string, "analyze" | "enhance" | "both">>({});
  const [enhanceProgress, setEnhanceProgress] = useState<Record<string, { current: number; total: number }>>({});
  const [selectedVersions, setSelectedVersions] = useState<Record<string, "original" | "enhanced">>({});
  const [pendingCount, setPendingCount] = useState<{ done: number; total: number } | null>(null);
  const [uploaderName, setUploaderName] = useState<string | null>(null);
  const [trackFlagTarget, setTrackFlagTarget] = useState<string | null>(null);
  const [reconstructing, setReconstructing] = useState(false);
  const [reconstructTarget, setReconstructTarget] = useState<string | null>(null);
  const [speakerPreviews, setSpeakerPreviews] = useState<Array<{ speaker: string; url: string }>>([]);
  const [showSpeakerDialog, setShowSpeakerDialog] = useState(false);
  const [applyingSpeaker, setApplyingSpeaker] = useState(false);
  const actionsLog = useRef<ActionEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch pending count for this campaign
  const fetchPendingCount = useCallback(async () => {
    if (!campaignId) return;
    const { count: totalCount } = await supabase
      .from("voice_recordings")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);
    const { count: pendingTotal } = await supabase
      .from("voice_recordings")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("quality_status", ["pending", "failed"]);
    if (totalCount != null && pendingTotal != null) {
      setPendingCount({ done: totalCount - pendingTotal, total: totalCount });
    }
  }, [campaignId]);

  // Load task config
  useEffect(() => {
    if (!campaignId) return;
    supabase.from("campaigns").select("name").eq("id", campaignId).maybeSingle()
      .then(({ data }) => setCampaignName(data?.name || ""));

    supabase.from("campaign_task_sets").select("id, task_type").eq("campaign_id", campaignId).limit(1)
      .then(async ({ data: sets }) => {
        if (!sets?.length) return;
        setTaskSetId(sets[0].id);
        // Fetch ui_label from task_type_catalog
        if ((sets[0] as any).task_type) {
          const { data: catalog } = await supabase.from("task_type_catalog" as any)
            .select("ui_label")
            .eq("task_type", (sets[0] as any).task_type)
            .maybeSingle();
          if (catalog) setTaskTypeLabel((catalog as any).ui_label || "");
        }
        const { data: config } = await supabase.from("validation_task_config")
          .select("time_limit_seconds, tracked_actions")
          .eq("task_set_id", sets[0].id)
          .eq("is_active", true)
          .maybeSingle();
        if (config) {
          setTimeLimit(config.time_limit_seconds);
          setTrackedActions(config.tracked_actions || []);
        }
      });
  }, [campaignId]);

  // Refetch siblings data
  const refetchSiblings = useCallback(async () => {
    if (!rec) return;
    if (rec.session_id && rec.campaign_id) {
      const { data } = await supabase
        .from("voice_recordings")
        .select("id, filename, file_url, duration_seconds, recording_type, metadata, discord_username, snr_db, quality_status")
        .eq("session_id", rec.session_id)
        .eq("campaign_id", rec.campaign_id)
        .order("recording_type");
      if (!data?.length) { setSiblings([rec]); return; }
      const sorted = [...data].sort((a, b) => {
        const aM = a.recording_type === "mixed" ? 0 : 1;
        const bM = b.recording_type === "mixed" ? 0 : 1;
        return aM - bM;
      });
      setSiblings(sorted as any[]);
    }
  }, [rec]);

  // Load siblings when rec changes
  useEffect(() => {
    if (!rec) { setSiblings([]); return; }
    refetchSiblings();
  }, [rec, refetchSiblings]);

  // Auto-refresh: poll analysis_queue for queued jobs AND check metadata for enhance completion
  useEffect(() => {
    const queuedIds = Object.keys(queuedJobs);
    if (queuedIds.length === 0) return;

    const interval = setInterval(async () => {
      // 1. Check analysis_queue for analyze jobs + enhance progress
      const { data: jobs } = await supabase
        .from("analysis_queue")
        .select("recording_id, job_type, status, current_segment, total_segments")
        .in("recording_id", queuedIds)
        .order("created_at", { ascending: false });

      // Update enhance progress from queue data
      if (jobs) {
        const newProgress: Record<string, { current: number; total: number }> = {};
        for (const j of jobs) {
          if (j.job_type === "enhance" && j.total_segments > 0 && j.status !== "done") {
            newProgress[j.recording_id] = { current: j.current_segment, total: j.total_segments };
          }
        }
        setEnhanceProgress(prev => ({ ...prev, ...newProgress }));
      }

      // 2. For enhance jobs, check metadata directly (edge function updates it)
      const enhanceIds = queuedIds.filter(id => {
        const job = queuedJobs[id];
        return job === "enhance" || job === "both";
      });

      let enhanceDoneIds = new Set<string>();
      if (enhanceIds.length > 0) {
        const { data: recs } = await supabase
          .from("voice_recordings")
          .select("id, metadata")
          .in("id", enhanceIds);
        if (recs) {
          for (const r of recs) {
            const meta = (r.metadata || {}) as Record<string, unknown>;
            if (meta.enhanced_file_url) {
              enhanceDoneIds.add(r.id);
            }
          }
        }
      }

      // Group latest status per recording+job_type from queue
      const latestStatus: Record<string, Record<string, string>> = {};
      if (jobs) {
        for (const j of jobs) {
          if (!latestStatus[j.recording_id]) latestStatus[j.recording_id] = {};
          if (!latestStatus[j.recording_id][j.job_type]) {
            latestStatus[j.recording_id][j.job_type] = j.status;
          }
        }
      }

      let anyDone = false;
      const newQueued = { ...queuedJobs };

      for (const recId of queuedIds) {
        const statuses = latestStatus[recId] || {};
        const currentJob = newQueued[recId];
        const analyzeDone = statuses["analyze"] === "done";
        const enhanceDone = enhanceDoneIds.has(recId) || statuses["enhance"] === "done";

        if (currentJob === "both") {
          if (analyzeDone && enhanceDone) { delete newQueued[recId]; anyDone = true; }
          else if (analyzeDone) { newQueued[recId] = "enhance"; anyDone = true; }
          else if (enhanceDone) { newQueued[recId] = "analyze"; anyDone = true; }
        } else if (currentJob === "analyze" && analyzeDone) {
          delete newQueued[recId]; anyDone = true;
        } else if (currentJob === "enhance" && enhanceDone) {
          delete newQueued[recId]; anyDone = true;
        }
      }

      if (anyDone) {
        setQueuedJobs(newQueued);
        // Clean up progress for finished enhance jobs
        setEnhanceProgress(prev => {
          const copy = { ...prev };
          for (const recId of queuedIds) {
            if (!newQueued[recId] || (newQueued[recId] !== "enhance" && newQueued[recId] !== "both")) {
              delete copy[recId];
            }
          }
          return copy;
        });
        await refetchSiblings();
        toast.success("Processamento concluído!", { description: "Os dados foram atualizados." });
      }
    }, 10000); // Poll every 10s instead of 30s

    return () => clearInterval(interval);
  }, [queuedJobs, refetchSiblings]);

  const skippedIdsRef = useRef<Set<string>>(new Set());

  const loadNext = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setElapsed(0);
    actionsLog.current = [];
    setTaskLogId(null);
    setQueuedJobs({});
    setSelectedVersions({});
    setEnhanceProgress({});
    if (timerRef.current) clearInterval(timerRef.current);
    fetchPendingCount();

    let query = supabase
      .from("voice_recordings")
      .select("id, filename, file_url, duration_seconds, session_id, created_at, discord_username, quality_status, recording_type, metadata, snr_db, campaign_id, user_id")
      .eq("campaign_id", campaignId)
      .in("quality_status", ["pending", "failed"])
      .order("created_at", { ascending: true });

    // Exclude already skipped/timed-out IDs in this session
    const skippedArr = Array.from(skippedIdsRef.current);
    if (skippedArr.length > 0) {
      // Use .not('id', 'in', ...) to exclude skipped recordings
      query = query.not("id", "in", `(${skippedArr.join(",")})`);
    }

    const { data } = await query.limit(1);

    if (!data?.length) { setRec(null); setLoading(false); setUploaderName(null); return; }
    setRec(data[0] as Recording);

    // Fetch uploader profile name
    if (data[0].user_id) {
      supabase.from("profiles").select("full_name").eq("id", data[0].user_id).single()
        .then(({ data: profile }) => setUploaderName(profile?.full_name || null));
    } else {
      setUploaderName(null);
    }
    setLoading(false);

    if (user && taskSetId) {
      const { data: log } = await supabase.from("validation_task_log").insert({
        user_id: user.id,
        submission_id: data[0].id,
        submission_type: "audio",
        campaign_id: campaignId,
        task_set_id: taskSetId,
        status: "in_progress",
        actions_log: [],
        time_spent_seconds: 0,
      }).select("id").single();
      if (log) setTaskLogId(log.id);
    }
  }, [campaignId, user, taskSetId, fetchPendingCount]);

  useEffect(() => { loadNext(); }, [loadNext]);

  // Timer — pauses while an enhance job is in progress
  const hasActiveEnhance = Object.values(queuedJobs).some(j => j === "enhance" || j === "both");

  useEffect(() => {
    if (!rec || loading || hasActiveEnhance) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= timeLimit) { handleTimeout(); return next; }
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [rec, loading, timeLimit, hasActiveEnhance]);

  const logAction = (action: string, detail?: string) => {
    if (trackedActions.length > 0 && !trackedActions.includes(action)) return;
    actionsLog.current.push({ action, timestamp: new Date().toISOString(), detail });
  };

  const finishTask = async (status: "completed" | "timeout", result?: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!taskLogId || !user) return;
    await supabase.from("validation_task_log").update({
      status, result: result || null,
      actions_log: actionsLog.current as any,
      time_spent_seconds: elapsed,
      completed_at: new Date().toISOString(),
    }).eq("id", taskLogId);

    const currentTotal = await supabase.from("profiles").select("total_review_seconds").eq("id", user.id).maybeSingle();
    const prev = (currentTotal.data as any)?.total_review_seconds || 0;
    await supabase.from("profiles").update({ total_review_seconds: prev + elapsed }).eq("id", user.id);
  };

  const handleTimeout = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (rec) skippedIdsRef.current.add(rec.id);
    toast.warning("Tempo esgotado! Carregando próximo conteúdo...");
    await finishTask("timeout");
    loadNext();
  };

  const handleApprove = async () => {
    if (!rec) return;
    setSaving(true);
    logAction("approve");

    // Approve ALL recordings in the same session so siblings don't reappear in queue
    let query = supabase.from("voice_recordings").update({ quality_status: "approved" });

    if (rec.session_id && rec.campaign_id) {
      query = query.eq("session_id", rec.session_id).eq("campaign_id", rec.campaign_id);
    } else {
      query = query.eq("id", rec.id);
    }

    const { error } = await query;
    setSaving(false);
    if (error) { toast.error("Erro ao aprovar"); return; }
    toast.success("Sessão aprovada!");
    await finishTask("completed", "approved");
    loadNext();
  };

  const handleReject = async (reasons: string[], note: string) => {
    if (!rec) return;
    setSaving(true);
    logAction("reject", reasons.join(", "));
    const rejection = [...reasons, note].filter(Boolean).join("; ");

    // Reject ALL recordings in the same session so siblings don't reappear in queue
    let query = supabase.from("voice_recordings")
      .update({ quality_status: "rejected", quality_rejection_reason: rejection });

    if (rec.session_id && rec.campaign_id) {
      query = query.eq("session_id", rec.session_id).eq("campaign_id", rec.campaign_id);
    } else {
      query = query.eq("id", rec.id);
    }

    const { error } = await query;
    setSaving(false);
    setShowRejectModal(false);
    if (error) { toast.error("Erro ao reprovar"); return; }
    toast.success("Sessão reprovada.");
    await finishTask("completed", "rejected");
    loadNext();
  };

  const handleReserve = async () => {
    if (!rec) return;
    setSaving(true);
    logAction("reserve");
    // Apply to ALL tracks in the same session
    let query = supabase.from("voice_recordings").update({ quality_status: "reserve" });
    if (rec.session_id && rec.campaign_id) {
      query = query.eq("session_id", rec.session_id).eq("campaign_id", rec.campaign_id);
    } else {
      query = query.eq("id", rec.id);
    }
    const { error } = await query;
    setSaving(false);
    if (error) { toast.error("Erro ao reservar"); return; }
    toast.success("Sessão marcada como Reserva.");
    await finishTask("completed", "reserve");
    loadNext();
  };

  const handleFlag = async (reason: string) => {
    if (!rec) return;
    setSaving(true);
    logAction("flag", reason);
    // Apply to ALL tracks in the same session
    let query = supabase.from("voice_recordings").update({
      quality_status: "flagged",
      flag_reason: reason,
    });
    if (rec.session_id && rec.campaign_id) {
      query = query.eq("session_id", rec.session_id).eq("campaign_id", rec.campaign_id);
    } else {
      query = query.eq("id", rec.id);
    }
    const { error } = await query;
    setSaving(false);
    setShowFlagModal(false);
    if (error) { toast.error("Erro ao flaguear"); return; }
    toast.success("Sessão flagueada para revisão.");
    await finishTask("completed", "flagged");
    loadNext();
  };

  const handleTrackFlag = async (reason: string) => {
    if (!trackFlagTarget) return;
    const sib = siblings.find((s: any) => s.id === trackFlagTarget);
    if (!sib) return;
    setSaving(true);
    logAction("track_flag", `${trackFlagTarget}: ${reason}`);
    const meta = sib.metadata || {};
    const { error } = await supabase
      .from("voice_recordings")
      .update({ metadata: { ...meta, track_flag_reason: reason } })
      .eq("id", trackFlagTarget);
    setSaving(false);
    setTrackFlagTarget(null);
    if (error) { toast.error("Erro ao flaguear track"); return; }
    toast.success("Track flagueada!");
    await refetchSiblings();
  };

  // Check if reconstruction is possible (mixed + individual tracks exist)
  const mixedSib = siblings.find((s: any) => s.recording_type === "mixed");
  const individualSibs = siblings.filter((s: any) => s.recording_type === "individual");
  const hasDiarization = !!(mixedSib?.metadata?.elevenlabs_words?.length);
  const canReconstruct = !!mixedSib && individualSibs.length > 0;

  const handleReconstructTrack = async (targetId: string) => {
    if (!rec?.session_id || !canReconstruct || !mixedSib) return;
    setReconstructing(true);
    setReconstructTarget(targetId);

    try {
      // Step 1: If no diarization yet, run ElevenLabs transcription on the mixed first
      if (!hasDiarization) {
        const transToastId = toast.loading("Etapa 1/2: Transcrevendo mixed com ElevenLabs...", {
          description: "Gerando diarização por speaker.",
        });
        try {
          const { data: transData, error: transError } = await supabase.functions.invoke("transcribe-elevenlabs", {
            body: { recording_id: mixedSib.id, force: true, mode: "full" },
          });
          if (transError) throw transError;
          if (transData?.error) throw new Error(transData.error);
          if (transData?.skipped) throw new Error(transData.reason || "Transcrição foi ignorada");
          toast.success("Transcrição ElevenLabs concluída", { id: transToastId });
          await refetchSiblings();
        } catch (err: any) {
          toast.error("Falha na transcrição ElevenLabs", { id: transToastId, description: err.message });
          setReconstructing(false);
          setReconstructTarget(null);
          return;
        }
      }

      // Step 2: Get speaker previews from VPS
      const reconToastId = toast.loading(
        hasDiarization ? "Separando speakers do mixed..." : "Etapa 2/2: Separando speakers...",
        { description: "Isso pode levar alguns minutos." }
      );
      try {
        const { data, error } = await supabase.functions.invoke("reconstruct-tracks", {
          body: { session_id: rec.session_id, mode: "preview" },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success(`${data.speakers?.length || 0} speakers encontrados`, { id: reconToastId });
        setSpeakerPreviews(data.speakers || []);
        setShowSpeakerDialog(true);
      } catch (err: any) {
        toast.error("Erro na reconstrução", { id: reconToastId, description: err.message });
        setReconstructing(false);
        setReconstructTarget(null);
      }
    } catch {
      setReconstructing(false);
      setReconstructTarget(null);
    }
  };

  const handleSpeakerSelected = async (speaker: { speaker: string; url: string }) => {
    if (!rec?.session_id || !reconstructTarget) return;
    setApplyingSpeaker(true);
    try {
      const { data, error } = await supabase.functions.invoke("reconstruct-tracks", {
        body: {
          session_id: rec.session_id,
          mode: "apply",
          target_recording_id: reconstructTarget,
          speaker_label: speaker.speaker,
          preview_url: speaker.url,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Trilha substituída com sucesso!");
      await refetchSiblings();
    } catch (err: any) {
      toast.error("Erro ao aplicar speaker", { description: err.message });
    } finally {
      setApplyingSpeaker(false);
      setShowSpeakerDialog(false);
      setReconstructing(false);
      setReconstructTarget(null);
      setSpeakerPreviews([]);
    }
  };

  const handleSkip = async () => {
    logAction("skip");
    if (rec) skippedIdsRef.current.add(rec.id);
    await finishTask("timeout");
    loadNext();
  };

  const handleReanalyze = async (sibId: string) => {
    logAction("reanalyze", sibId);
    setQueuedJobs(prev => ({ ...prev, [sibId]: prev[sibId] === "enhance" ? "both" : "analyze" }));

    const sib = siblings?.find((s: any) => s.id === sibId);
    const audioUrl = sib?.mp3_file_url || sib?.file_url;

    if (!audioUrl) {
      toast.error("URL do áudio não encontrada");
      setQueuedJobs(prev => {
        const copy = { ...prev };
        if (copy[sibId] === "both") copy[sibId] = "enhance";
        else delete copy[sibId];
        return copy;
      });
      return;
    }

    const toastId = toast.loading("Análise em andamento…", {
      description: "Aguarde enquanto o processamento é realizado.",
    });

    const { data, error } = await supabase.functions.invoke("estimate-audio-metrics", {
      body: {
        recording_id: sibId,
        file_url: audioUrl,
        mode: "sampled",
      },
    });

    if (error) {
      toast.error("Erro ao solicitar reanálise", { id: toastId, description: error.message });
      setQueuedJobs(prev => {
        const copy = { ...prev };
        if (copy[sibId] === "both") copy[sibId] = "enhance";
        else delete copy[sibId];
        return copy;
      });
      return;
    }

    const service = data?.service || "desconhecido";
    toast.success("Reanálise concluída!", {
      id: toastId,
      description: `Serviço: ${service}`,
    });
    setQueuedJobs(prev => {
      const copy = { ...prev };
      if (copy[sibId] === "both") copy[sibId] = "enhance";
      else delete copy[sibId];
      return copy;
    });
    await refetchSiblings();
  };

  const handleEnhance = async (sibId: string) => {
    logAction("enhance", sibId);
    setQueuedJobs(prev => ({ ...prev, [sibId]: prev[sibId] === "analyze" ? "both" : "enhance" }));

    const sib = siblings?.find((s: any) => s.id === sibId);
    const fileUrl = sib?.file_url;

    if (!fileUrl) {
      toast.error("URL do arquivo não encontrada");
      setQueuedJobs(prev => {
        const copy = { ...prev };
        if (copy[sibId] === "both") copy[sibId] = "analyze";
        else delete copy[sibId];
        return copy;
      });
      return;
    }

    // Get provider name first (fast call)
    let serviceName = "";
    try {
      const { data: providerData } = await supabase.functions.invoke("enhance-audio", {
        body: { preview_provider: true },
      });
      serviceName = providerData?.service || "";
    } catch { /* ignore */ }

    toast.info("Enhancement iniciado!", {
      description: serviceName
        ? `Processando via ${serviceName}. O polling atualizará quando concluir.`
        : "O polling atualizará quando o processamento concluir.",
    });

    // Fire-and-forget: don't await the long-running enhance call
    // The polling mechanism (every 10s) will detect completion via metadata.enhanced_file_url
    supabase.functions.invoke("enhance-audio", {
      body: {
        recording_id: sibId,
        file_url: fileUrl,
      },
    }).then(({ data, error }) => {
      if (error) {
        console.warn("[enhance] Edge function returned error (may have timed out but still processing):", error.message);
      } else {
        console.log("[enhance] Edge function completed:", data);
      }
    }).catch((err) => {
      console.warn("[enhance] Edge function call failed (processing may continue server-side):", err);
    });
  };

  const remaining = Math.max(0, timeLimit - elapsed);
  const timerMinutes = Math.floor(remaining / 60);
  const timerSeconds = remaining % 60;
  const timerPercent = (elapsed / timeLimit) * 100;
  const isUrgent = remaining <= 30;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-white/60" />
      </div>
    );
  }

  if (!rec) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <Headphones className="h-16 w-16 text-white/10 mx-auto mb-4" />
        <h2 className="text-[24px] font-bold text-white mb-2">Tudo validado!</h2>
        <p className="text-white/40 mb-6">Não há mais áudios pendentes nesta campanha.</p>
        <Button variant="outline" onClick={() => navigate("/data")}
          className="bg-white/5 border-white/10 text-white hover:bg-white/10">
          Voltar ao início
        </Button>
      </div>
    );
  }

  const meta = rec.metadata || {};
  const mainTier = deriveTier(rec);

  return (
    <div className="max-w-4xl mx-auto pb-32">
      {/* Back + Campaign + Counter */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(`/data/audio/campaigns`)} className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft className="h-4 w-4" /> {campaignName}
        </button>
        {pendingCount && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08]">
            <span className="text-[13px] font-mono font-bold text-white">{pendingCount.done}</span>
            <span className="text-[13px] text-white/30">/</span>
            <span className="text-[13px] font-mono text-white/50">{pendingCount.total}</span>
            <span className="text-[11px] text-white/30 ml-1">validados</span>
          </div>
        )}
      </div>

      {/* Timer bar */}
      <div className="data-glass-card rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Clock className={cn("h-5 w-5", isUrgent ? "text-red-400" : "text-white/40")} />
            <span className={cn("text-[28px] font-mono font-bold tracking-wider", isUrgent ? "text-red-400" : "text-white")}>
              {String(timerMinutes).padStart(2, "0")}:{String(timerSeconds).padStart(2, "0")}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={handleSkip}
            className="bg-white/[0.08] border-white/[0.12] text-white/70 hover:bg-white/[0.15] hover:text-white font-semibold gap-1.5">
            <SkipForward className="h-4 w-4" /> Pular
          </Button>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-1000", isUrgent ? "bg-red-500" : "bg-white/30")}
            style={{ width: `${Math.min(100, timerPercent)}%` }}
          />
        </div>
      </div>

      {/* Identification card */}
      <div className="data-glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            {taskTypeLabel && (
              <p className="text-[12px] text-white/40 uppercase font-semibold tracking-wider mb-1">{taskTypeLabel}</p>
            )}
            <h1 className="text-[22px] font-bold text-white mb-1">
              {campaignName || rec.filename}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const source = meta?.source;
              const isStudio = source === "webapp";
              return (
                <span className={cn(
                  "text-[12px] font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider",
                  isStudio
                    ? "bg-violet-500/20 text-violet-400 border-violet-500/30"
                    : "bg-orange-500/20 text-orange-400 border-orange-500/30"
                )}>
                  {isStudio ? "Estúdio" : "Upload"}
                </span>
              );
            })()}
            {mainTier && (
              <span className={cn("text-[13px] font-bold px-3 py-1.5 rounded-lg border", tierColors[mainTier] || "bg-white/10 text-white/60 border-white/10")}>
                {mainTier} — {tierLabels[mainTier] || mainTier}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Mic2, label: "Sessão", value: rec.session_id?.slice(0, 8) || "—" },
            { icon: User, label: "Enviado por", value: uploaderName || rec.discord_username || "—" },
            { icon: Clock, label: "Duração", value: formatTime(rec.duration_seconds || 0) },
            { icon: Globe, label: "Data", value: new Date(rec.created_at).toLocaleDateString("pt-BR") },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                <item.icon className="h-5 w-5 text-white/40" />
              </div>
              <div>
                <p className="text-[11px] text-white/30 uppercase font-semibold tracking-wider">{item.label}</p>
                <p className="text-[15px] font-semibold text-white/90">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* All tracks */}
      {siblings.length > 0 && (
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-white/80">
              {siblings.length > 1 ? "Trilhas da Sessão" : "Áudio & Métricas"}
            </h2>
          </div>
          {siblings.map((sib) => {
            const isMain = sib.id === rec.id;
            const enhancedUrl = (sib.metadata as any)?.enhanced_file_url;
            const originalUrl = sib.file_url;
            const hasEnhanced = !!enhancedUrl;
            const sibTier = deriveTier(sib);
            const sibEnhancedTier = deriveEnhancedTier(sib);
            const sibMetrics = getTrackMetrics(sib);
            const sibEnhancedMetrics = getEnhancedMetrics(sib);
            const jobState = queuedJobs[sib.id];
            const analyzeQueued = jobState === "analyze" || jobState === "both";
            const enhanceQueued = jobState === "enhance" || jobState === "both";

            return (
              <TrackCard
                key={sib.id}
                sib={sib}
                isMain={isMain}
                hasEnhanced={hasEnhanced}
                enhancedUrl={enhancedUrl}
                originalUrl={originalUrl}
                sibTier={sibTier}
                enhancedTier={sibEnhancedTier}
                sibMetrics={sibMetrics}
                enhancedMetrics={sibEnhancedMetrics}
                analyzeQueued={analyzeQueued}
                enhanceQueued={enhanceQueued}
                enhanceProgress={enhanceProgress[sib.id]}
                logAction={logAction}
                handleReanalyze={handleReanalyze}
                handleEnhance={handleEnhance}
                handleTrackFlag={(id) => setTrackFlagTarget(id)}
                trackFlagReason={(sib.metadata as any)?.track_flag_reason || null}
                selectedVersion={selectedVersions[sib.id] || "original"}
                onSelectVersion={(id, v) => setSelectedVersions(prev => ({ ...prev, [id]: v }))}
                handleReconstruct={canReconstruct && sib.recording_type === "individual" ? handleReconstructTrack : undefined}
                reconstructing={reconstructing && reconstructTarget === sib.id}
              />
            );
          })}
        </div>
      )}

      {/* Decision bar - fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-2xl bg-black/70 border-t border-white/[0.06] p-4">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <Button onClick={handleApprove} disabled={saving}
            className="flex-1 h-12 text-[14px] font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20">
            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Aprovar
          </Button>
          <Button onClick={handleReserve} disabled={saving}
            className="flex-1 h-12 text-[14px] font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20">
            <Archive className="h-4 w-4 mr-1.5" /> Reserva
          </Button>
          <Button onClick={() => setShowFlagModal(true)} disabled={saving}
            className="flex-1 h-12 text-[14px] font-semibold rounded-xl bg-amber-500 hover:bg-amber-400 text-white shadow-lg shadow-amber-500/20">
            <Flag className="h-4 w-4 mr-1.5" /> Flag
          </Button>
          <Button onClick={() => setShowRejectModal(true)} disabled={saving}
            className="flex-1 h-12 text-[14px] font-semibold rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20">
            <XCircle className="h-4 w-4 mr-1.5" /> Reprovar
          </Button>
        </div>
      </div>

      {campaignId && (
        <RejectionReasonModal
          open={showRejectModal}
          onClose={() => setShowRejectModal(false)}
          onConfirm={handleReject}
          campaignId={campaignId}
          useAdminReasons
        />
      )}

      <FlagReasonModal
        open={showFlagModal}
        onClose={() => setShowFlagModal(false)}
        onConfirm={handleFlag}
      />

      <TrackFlagReasonModal
        open={!!trackFlagTarget}
        onClose={() => setTrackFlagTarget(null)}
        onConfirm={handleTrackFlag}
        trackLabel={siblings.find((s: any) => s.id === trackFlagTarget)?.discord_username || siblings.find((s: any) => s.id === trackFlagTarget)?.recording_type || ""}
      />

      <SpeakerSelectDialog
        open={showSpeakerDialog}
        speakers={speakerPreviews}
        targetTrackName={
          siblings.find((s: any) => s.id === reconstructTarget)?.discord_username ||
          siblings.find((s: any) => s.id === reconstructTarget)?.recording_type || ""
        }
        onSelect={handleSpeakerSelected}
        onCancel={() => {
          setShowSpeakerDialog(false);
          setReconstructing(false);
          setReconstructTarget(null);
          setSpeakerPreviews([]);
        }}
        applying={applyingSpeaker}
      />
    </div>
  );
}
