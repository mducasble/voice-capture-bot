import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, XCircle, ArrowLeft, Clock,
  Headphones, Sparkles, RefreshCw, SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/audit/MetricCard";
import { RejectionReasonModal } from "@/components/audit/RejectionReasonModal";
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

export default function DataAudioTask() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rec, setRec] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timeLimit, setTimeLimit] = useState(300);
  const [trackedActions, setTrackedActions] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [taskLogId, setTaskLogId] = useState<string | null>(null);
  const actionsLog = useRef<ActionEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load task config
  useEffect(() => {
    if (!campaignId) return;
    supabase.from("campaigns").select("name").eq("id", campaignId).maybeSingle()
      .then(({ data }) => setCampaignName(data?.name || ""));

    // Get validation_task_config for this campaign's task_sets
    supabase.from("campaign_task_sets").select("id").eq("campaign_id", campaignId).limit(1)
      .then(async ({ data: sets }) => {
        if (!sets?.length) return;
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

  // Load next pending recording
  const loadNext = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setElapsed(0);
    actionsLog.current = [];
    setTaskLogId(null);

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

    // Create task log entry
    if (user) {
      const { data: log } = await supabase.from("validation_task_log").insert({
        user_id: user.id,
        recording_id: data[0].id,
        campaign_id: campaignId,
        status: "in_progress",
        actions_log: [],
        time_spent_seconds: 0,
      }).select("id").single();
      if (log) setTaskLogId(log.id);
    }
  }, [campaignId, user]);

  useEffect(() => { loadNext(); }, [loadNext]);

  // Timer
  useEffect(() => {
    if (!rec || loading) return;
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= timeLimit) {
          handleTimeout();
          return next;
        }
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [rec, loading, timeLimit]);

  const logAction = (action: string, detail?: string) => {
    if (!trackedActions.includes(action) && trackedActions.length > 0) return;
    actionsLog.current.push({ action, timestamp: new Date().toISOString(), detail });
  };

  const finishTask = async (status: "completed" | "timeout", result?: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!taskLogId || !user) return;

    await supabase.from("validation_task_log").update({
      status,
      result: result || null,
      actions_log: actionsLog.current,
      time_spent_seconds: elapsed,
      completed_at: new Date().toISOString(),
    }).eq("id", taskLogId);

    // Accumulate review time on profile
    await supabase.rpc("update_review_seconds" as any, { p_user_id: user.id, p_seconds: elapsed }).catch(() => {
      // Fallback: direct update
      supabase.from("profiles").update({
        total_review_seconds: (elapsed)
      }).eq("id", user.id);
    });
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

  const handleSkip = async () => {
    logAction("skip");
    await finishTask("timeout");
    loadNext();
  };

  const remaining = Math.max(0, timeLimit - elapsed);
  const timerMinutes = Math.floor(remaining / 60);
  const timerSeconds = remaining % 60;
  const timerPercent = (elapsed / timeLimit) * 100;
  const isUrgent = remaining <= 30;

  const getMetricStatus = (key: string, val: number | null): "good" | "fair" | "bad" | "neutral" => {
    if (val == null) return "neutral";
    const v = Number(val);
    switch (key) {
      case "snr_db": return v >= 30 ? "good" : v >= 25 ? "fair" : "bad";
      case "sigmos_ovrl": return v >= 3.0 ? "good" : v >= 2.3 ? "fair" : "bad";
      case "srmr": return v >= 7 ? "good" : v >= 5.4 ? "fair" : "bad";
      case "rms_dbfs": return v >= -24 ? "good" : v >= -26 ? "fair" : "bad";
      case "wvmos": return v >= 3.5 ? "good" : v >= 2.5 ? "fair" : "bad";
      case "vqscore": return v >= 0.65 ? "good" : v >= 0.5 ? "fair" : "bad";
      default: return "neutral";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
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
  const audioUrl = meta.enhanced_file_url || rec.file_url;
  const tier = typeof meta.quality_tier === "string" ? meta.quality_tier.toUpperCase() : undefined;
  const tierColors: Record<string, string> = {
    PQ: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    HQ: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MQ: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    LQ: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const metricKeys = [
    { key: "snr_db", label: "SNR", unit: "dB", val: rec.snr_db ?? meta.snr_db },
    { key: "sigmos_ovrl", label: "SigMOS", val: meta.sigmos_ovrl },
    { key: "srmr", label: "SRMR", val: meta.srmr },
    { key: "rms_dbfs", label: "RMS", unit: "dBFS", val: meta.rms_dbfs },
    { key: "wvmos", label: "WVMOS", val: meta.wvmos },
    { key: "vqscore", label: "VQScore", val: meta.vqscore },
    { key: "sigmos_reverb", label: "Reverb", val: meta.sigmos_reverb },
    { key: "sigmos_disc", label: "Disc", val: meta.sigmos_disc },
  ].filter((m) => m.val != null);

  return (
    <div className="max-w-3xl mx-auto pb-32">
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
            className={cn("h-full rounded-full transition-all duration-1000", isUrgent ? "bg-red-500" : "bg-[hsl(var(--primary))]")}
            style={{ width: `${Math.min(100, timerPercent)}%` }}
          />
        </div>
      </div>

      {/* Audio card */}
      <div className="data-glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="h-12 w-12 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center">
            <Headphones className="h-6 w-6 text-[hsl(var(--primary))]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[18px] font-bold text-white truncate">{rec.discord_username || rec.filename}</h2>
            <p className="text-[13px] text-white/40">
              {rec.duration_seconds ? `${Math.floor(rec.duration_seconds / 60)}:${String(Math.floor(rec.duration_seconds % 60)).padStart(2, "0")}` : "—"}
              {rec.recording_type && ` · ${rec.recording_type}`}
            </p>
          </div>
          {tier && (
            <span className={cn("text-[13px] font-bold px-3 py-1.5 rounded-lg border", tierColors[tier] || "bg-white/10 text-white/60 border-white/10")}>
              {tier}
            </span>
          )}
        </div>

        {/* Player */}
        {audioUrl && (
          <audio
            controls
            src={audioUrl}
            className="w-full h-12 rounded-xl mb-5"
            preload="metadata"
            onPlay={() => logAction("play")}
            onPause={() => logAction("pause")}
            onSeeked={() => logAction("seek")}
          />
        )}

        {/* Metrics */}
        {metricKeys.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {metricKeys.map((m) => (
              <MetricCard
                key={m.key}
                label={m.label}
                value={typeof m.val === "number" ? Number(m.val).toFixed(2) : String(m.val)}
                unit={m.unit}
                tier={tier}
              />
            ))}
          </div>
        )}
      </div>

      {/* Decision bar - fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-2xl bg-black/60 border-t border-white/[0.06] p-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Button onClick={handleApprove} disabled={saving}
            className="flex-1 h-14 text-[16px] font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20">
            <CheckCircle2 className="h-5 w-5 mr-2" /> Aprovar
          </Button>
          <Button onClick={() => setShowRejectModal(true)} disabled={saving}
            className="flex-1 h-14 text-[16px] font-semibold rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20">
            <XCircle className="h-5 w-5 mr-2" /> Reprovar
          </Button>
        </div>
      </div>

      <RejectionReasonModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        onConfirm={handleReject}
        loading={saving}
      />
    </div>
  );
}
