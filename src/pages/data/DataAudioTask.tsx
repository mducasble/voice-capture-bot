import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, XCircle, ArrowLeft, Clock,
  SkipForward, Mic2, User, Globe, Headphones,
  Archive, Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RejectionReasonModal } from "@/components/audit/RejectionReasonModal";
import { TrackCard } from "@/components/data/TrackCard";
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

function deriveTier(sib: any): string | undefined {
  const meta = sib.metadata || {};
  const stored = typeof meta.quality_tier === "string" ? meta.quality_tier.toUpperCase() : undefined;
  if (stored) return stored;

  // Derive from individual metrics — overall tier = lowest tier among all available metrics
  const metrics: [string, number | null | undefined][] = [
    ["snr_db", sib.snr_db ?? meta.snr_db],
    ["sigmos_ovrl", meta.sigmos_ovrl],
    ["srmr", meta.srmr],
    ["rms_dbfs", meta.rms_dbfs],
    ["wvmos", meta.wvmos],
    ["vqscore", meta.vqscore],
    ["sigmos_reverb", meta.sigmos_reverb],
    ["sigmos_disc", meta.sigmos_disc],
  ];

  let minOrder = 3; // start at PQ
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
    { key: "snr_db", label: "SNR", unit: "dB", val: sib.snr_db ?? meta.snr_db },
    { key: "sigmos_ovrl", label: "SigMOS Overall", val: meta.sigmos_ovrl },
    { key: "srmr", label: "SRMR", val: meta.srmr },
    { key: "rms_dbfs", label: "RMS Level", unit: "dBFS", val: meta.rms_dbfs },
    { key: "wvmos", label: "WVMOS", val: meta.wvmos },
    { key: "vqscore", label: "VQScore", val: meta.vqscore },
    { key: "sigmos_reverb", label: "SigMOS Reverb", val: meta.sigmos_reverb },
    { key: "sigmos_disc", label: "SigMOS Disc", val: meta.sigmos_disc },
  ].filter((m) => m.val != null);
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
  const [saving, setSaving] = useState(false);
  const [timeLimit, setTimeLimit] = useState(300);
  const [trackedActions, setTrackedActions] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [taskLogId, setTaskLogId] = useState<string | null>(null);
  const [taskSetId, setTaskSetId] = useState<string | null>(null);
  const [queuedJobs, setQueuedJobs] = useState<Record<string, "analyze" | "enhance" | "both">>({});
  const actionsLog = useRef<ActionEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load task config
  useEffect(() => {
    if (!campaignId) return;
    supabase.from("campaigns").select("name").eq("id", campaignId).maybeSingle()
      .then(({ data }) => setCampaignName(data?.name || ""));

    supabase.from("campaign_task_sets").select("id").eq("campaign_id", campaignId).limit(1)
      .then(async ({ data: sets }) => {
        if (!sets?.length) return;
        setTaskSetId(sets[0].id);
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

  // Load siblings when rec changes
  useEffect(() => {
    if (!rec) { setSiblings([]); return; }
    if (rec.session_id && rec.campaign_id) {
      supabase
        .from("voice_recordings")
        .select("id, filename, file_url, duration_seconds, recording_type, metadata, discord_username, snr_db, quality_status")
        .eq("session_id", rec.session_id)
        .eq("campaign_id", rec.campaign_id)
        .order("recording_type")
        .then(({ data }) => setSiblings(data?.length ? (data as any[]) : [rec]));
    } else {
      setSiblings([rec]);
    }
  }, [rec]);

  const loadNext = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setElapsed(0);
    actionsLog.current = [];
    setTaskLogId(null);
    setQueuedJobs({});
    if (timerRef.current) clearInterval(timerRef.current);

    const { data } = await supabase
      .from("voice_recordings")
      .select("id, filename, file_url, duration_seconds, session_id, created_at, discord_username, quality_status, recording_type, metadata, snr_db, campaign_id, user_id")
      .eq("campaign_id", campaignId)
      .eq("quality_status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (!data?.length) { setRec(null); setLoading(false); return; }
    setRec(data[0] as Recording);
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
  }, [campaignId, user, taskSetId]);

  useEffect(() => { loadNext(); }, [loadNext]);

  // Timer
  useEffect(() => {
    if (!rec || loading) return;
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= timeLimit) { handleTimeout(); return next; }
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [rec, loading, timeLimit]);

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
    toast.warning("Tempo esgotado! Carregando próximo conteúdo...");
    await finishTask("timeout");
    loadNext();
  };

  const handleApprove = async () => {
    if (!rec) return;
    setSaving(true);
    logAction("approve");
    const { error } = await supabase.from("voice_recordings").update({ quality_status: "approved" }).eq("id", rec.id);
    setSaving(false);
    if (error) { toast.error("Erro ao aprovar"); return; }
    toast.success("Aprovado!");
    await finishTask("completed", "approved");
    loadNext();
  };

  const handleReject = async (reasons: string[], note: string) => {
    if (!rec) return;
    setSaving(true);
    logAction("reject", reasons.join(", "));
    const rejection = [...reasons, note].filter(Boolean).join("; ");
    const { error } = await supabase.from("voice_recordings")
      .update({ quality_status: "rejected", quality_rejection_reason: rejection }).eq("id", rec.id);
    setSaving(false);
    setShowRejectModal(false);
    if (error) { toast.error("Erro ao reprovar"); return; }
    toast.success("Reprovado.");
    await finishTask("completed", "rejected");
    loadNext();
  };

  const handleReserve = async () => {
    if (!rec) return;
    setSaving(true);
    logAction("reserve");
    const { error } = await supabase.from("voice_recordings").update({ quality_status: "reserve" }).eq("id", rec.id);
    setSaving(false);
    if (error) { toast.error("Erro ao reservar"); return; }
    toast.success("Marcado como Reserva.");
    await finishTask("completed", "reserve");
    loadNext();
  };

  const handleFlag = async () => {
    if (!rec) return;
    setSaving(true);
    logAction("flag");
    const { error } = await supabase.from("voice_recordings").update({ quality_status: "flagged" }).eq("id", rec.id);
    setSaving(false);
    if (error) { toast.error("Erro ao flaguear"); return; }
    toast.success("Flagueado para revisão.");
    await finishTask("completed", "flagged");
    loadNext();
  };

  const handleSkip = async () => {
    logAction("skip");
    await finishTask("timeout");
    loadNext();
  };

  const handleReanalyze = async (sibId: string) => {
    logAction("reanalyze", sibId);
    setQueuedJobs(prev => ({ ...prev, [sibId]: prev[sibId] === "enhance" ? "both" : "analyze" }));
    
    const sib = siblings.find(s => s.id === sibId);
    const fileUrl = sib?.file_url;
    
    const { error } = await supabase.functions.invoke("estimate-audio-metrics", {
      body: { recording_id: sibId, file_url: fileUrl, mode: "sampled" },
    });
    
    if (error) { 
      toast.error("Erro ao reanalisar", { description: error.message }); 
      setQueuedJobs(prev => {
        const copy = { ...prev };
        if (copy[sibId] === "both") copy[sibId] = "enhance";
        else delete copy[sibId];
        return copy;
      });
      return; 
    }
    toast.success("Reanálise concluída!");
    // Reload siblings to get updated metrics
    if (rec?.session_id && rec?.campaign_id) {
      const { data } = await supabase
        .from("voice_recordings")
        .select("id, filename, file_url, duration_seconds, recording_type, metadata, discord_username, snr_db, quality_status")
        .eq("session_id", rec.session_id)
        .eq("campaign_id", rec.campaign_id)
        .order("recording_type");
      if (data?.length) setSiblings(data as any[]);
    }
    setQueuedJobs(prev => {
      const copy = { ...prev };
      if (copy[sibId] === "both") copy[sibId] = "enhance";
      else delete copy[sibId];
      return copy;
    });
  };

  const handleEnhance = async (sibId: string) => {
    logAction("enhance", sibId);
    setQueuedJobs(prev => ({ ...prev, [sibId]: prev[sibId] === "analyze" ? "both" : "enhance" }));
    
    const sib = siblings.find(s => s.id === sibId);
    const fileUrl = sib?.file_url;
    
    const { error } = await supabase.functions.invoke("enhance-audio", {
      body: { recording_id: sibId, file_url: fileUrl },
    });
    
    if (error) { 
      toast.error("Erro ao processar enhance", { description: error.message }); 
      setQueuedJobs(prev => {
        const copy = { ...prev };
        if (copy[sibId] === "both") copy[sibId] = "analyze";
        else delete copy[sibId];
        return copy;
      });
      return; 
    }
    toast.success("Enhance concluído!");
    // Reload siblings to get updated enhanced_file_url
    if (rec?.session_id && rec?.campaign_id) {
      const { data } = await supabase
        .from("voice_recordings")
        .select("id, filename, file_url, duration_seconds, recording_type, metadata, discord_username, snr_db, quality_status")
        .eq("session_id", rec.session_id)
        .eq("campaign_id", rec.campaign_id)
        .order("recording_type");
      if (data?.length) setSiblings(data as any[]);
    }
    setQueuedJobs(prev => {
      const copy = { ...prev };
      if (copy[sibId] === "both") copy[sibId] = "analyze";
      else delete copy[sibId];
      return copy;
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
      {/* Back + Campaign */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(`/data/audio/campaigns`)} className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft className="h-4 w-4" /> {campaignName}
        </button>
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
          <button onClick={handleSkip} className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors">
            <SkipForward className="h-4 w-4" /> Pular
          </button>
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
            <h1 className="text-[22px] font-bold text-white mb-1">
              {rec.discord_username || rec.filename}
            </h1>
            <p className="text-[14px] text-white/40">{campaignName}</p>
          </div>
          {mainTier && (
            <span className={cn("text-[13px] font-bold px-3 py-1.5 rounded-lg border", tierColors[mainTier] || "bg-white/10 text-white/60 border-white/10")}>
              {mainTier} — {tierLabels[mainTier] || mainTier}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Mic2, label: "Sessão", value: rec.session_id?.slice(0, 8) || "—" },
            { icon: Clock, label: "Duração", value: formatTime(rec.duration_seconds || 0) },
            { icon: Globe, label: "Data", value: new Date(rec.created_at).toLocaleDateString("pt-BR") },
            { icon: User, label: "Tipo", value: rec.recording_type || "—" },
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
          <h2 className="text-[18px] font-bold text-white/80">
            {siblings.length > 1 ? "Trilhas da Sessão" : "Áudio & Métricas"}
          </h2>
          {siblings.map((sib) => {
            const isMain = sib.id === rec.id;
            const enhancedUrl = (sib.metadata as any)?.enhanced_file_url;
            const originalUrl = sib.file_url;
            const hasEnhanced = !!enhancedUrl;
            const sibTier = deriveTier(sib);
            const sibMetrics = getTrackMetrics(sib);
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
                sibMetrics={sibMetrics}
                analyzeQueued={analyzeQueued}
                enhanceQueued={enhanceQueued}
                logAction={logAction}
                handleReanalyze={handleReanalyze}
                handleEnhance={handleEnhance}
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
          <Button onClick={handleFlag} disabled={saving}
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
        />
      )}
    </div>
  );
}
