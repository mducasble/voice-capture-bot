import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/audit/StatusBadge";
import { MetricCard } from "@/components/audit/MetricCard";
import { RejectionReasonModal } from "@/components/audit/RejectionReasonModal";
import {
  SkipForward, Loader2,
  ChevronRight, CheckCircle2, XCircle, Bookmark, RefreshCw,
  Sparkles, Headphones, User, Clock, Globe, Mic2,
} from "lucide-react";
import { toast } from "sonner";
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
  validation_status: string | null;
  recording_type: string | null;
  metadata: any;
  snr_db: number | null;
  campaign_id: string | null;
  quality_rejection_reason: string | null;
  user_id: string | null;
}

export default function AuditAudioDetail() {
  const { campaignId, recordingId } = useParams<{ campaignId: string; recordingId: string }>();
  const navigate = useNavigate();
  const [rec, setRec] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [siblings, setSiblings] = useState<any[]>([]);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [campaignName, setCampaignName] = useState("");

  useEffect(() => {
    if (!recordingId) return;
    let cancelled = false;

    const loadRecording = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("voice_recordings")
          .select("*")
          .eq("id", recordingId)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error("Failed to load audit recording", error);
          setRec(null);
          setCampaignName("");
          setLoading(false);
          return;
        }

        setRec((data as any) ?? null);
        setLoading(false);

        if (data?.campaign_id) {
          const { data: campaignData } = await supabase
            .from("campaigns")
            .select("name")
            .eq("id", data.campaign_id)
            .maybeSingle();

          if (!cancelled) {
            setCampaignName(campaignData?.name || "");
          }
        } else {
          setCampaignName("");
        }
      } catch (error) {
        console.error("Unexpected audit recording load error", error);
        if (!cancelled) {
          setRec(null);
          setCampaignName("");
          setLoading(false);
        }
      }
    };

    void loadRecording();

    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  // Load siblings (same session)
  useEffect(() => {
    if (!rec) {
      setSiblings([]);
      return;
    }

    let cancelled = false;

    const loadSiblings = async () => {
      if (rec.session_id && rec.campaign_id) {
        try {
          const { data, error } = await supabase
            .from("voice_recordings")
            .select("id, filename, file_url, duration_seconds, recording_type, metadata, discord_username, snr_db, quality_status")
            .eq("session_id", rec.session_id)
            .eq("campaign_id", rec.campaign_id)
            .order("recording_type");

          if (cancelled) return;
          if (error || !data?.length) {
            setSiblings([rec]);
            return;
          }

          setSiblings(data as any[]);
        } catch {
          if (!cancelled) setSiblings([rec]);
        }
      } else {
        setSiblings([rec]);
      }
    };

    void loadSiblings();

    return () => {
      cancelled = true;
    };
  }, [rec]);


  const handleApprove = async () => {
    if (!rec) return;
    setSaving(true);
    const { error } = await supabase
      .from("voice_recordings")
      .update({ quality_status: "approved" })
      .eq("id", rec.id);
    setSaving(false);
    if (error) { toast.error("Erro ao aprovar"); return; }
    toast.success("Áudio aprovado com sucesso!");
    setRec({ ...rec, quality_status: "approved" });
  };

  const handleReject = async (reasons: string[], note: string) => {
    if (!rec) return;
    setSaving(true);
    const rejection = [...reasons, note].filter(Boolean).join("; ");
    const { error } = await supabase
      .from("voice_recordings")
      .update({ quality_status: "rejected", quality_rejection_reason: rejection })
      .eq("id", rec.id);
    setSaving(false);
    setShowRejectModal(false);
    if (error) { toast.error("Erro ao reprovar"); return; }
    toast.success("Áudio reprovado.");
    setRec({ ...rec, quality_status: "rejected", quality_rejection_reason: rejection });
  };

  const handleReanalyze = async () => {
    if (!rec) return;
    toast.info("Adicionando à fila de reanálise...");
    await supabase.from("analysis_queue").insert({ recording_id: rec.id, job_type: "analyze", priority: 5 });
    toast.success("Reanálise enfileirada!");
  };

  const handleEnhance = async () => {
    if (!rec) return;
    toast.info("Adicionando à fila de enhance...");
    await supabase.from("analysis_queue").insert({ recording_id: rec.id, job_type: "enhance", priority: 10 });
    toast.success("Enhance enfileirado!");
  };

  const handleToggleFlag = async () => {
    if (!rec) return;
    setSaving(true);
    const newMeta = { ...rec.metadata, flagged_for_review: !rec.metadata?.flagged_for_review };
    const { error } = await supabase
      .from("voice_recordings")
      .update({ metadata: newMeta })
      .eq("id", rec.id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar flag"); return; }
    if (newMeta.flagged_for_review) {
      toast.success("Marcado para revisão posterior");
    } else {
      toast.info("Flag removida");
    }
    setRec({ ...rec, metadata: newMeta });
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const getMetricStatus = (key: string, val: number | null): "good" | "fair" | "bad" | "neutral" => {
    if (val === null || val === undefined) return "neutral";
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

  const metricTooltips: Record<string, string> = {
    snr_db: "Relação sinal-ruído. Quanto maior, menos ruído de fundo.",
    sigmos_ovrl: "Qualidade perceptual geral do áudio (escala 1-5).",
    srmr: "Taxa de modulação do reverberação. Valores altos indicam pouca reverberação.",
    rms_dbfs: "Nível médio de volume em decibéis. Valores próximos de 0 = mais alto.",
    wvmos: "Qualidade de fala estimada (escala 1-5).",
    vqscore: "Pontuação de qualidade vetorial (0-1).",
    sigmos_reverb: "Componente de reverberação na análise SigMOS.",
    sigmos_disc: "Componente de distorção/descontinuidade.",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  if (!rec) {
    return <div className="text-center py-20 text-[18px] text-[hsl(var(--muted-foreground))]">Gravação não encontrada.</div>;
  }

  const meta = rec.metadata || {};
  const audioUrl = meta.enhanced_file_url || rec.file_url;
  const tier = typeof meta.quality_tier === "string" ? meta.quality_tier.toUpperCase() : undefined;

  // Extract all metrics dynamically
  const metricKeys = [
    { key: "snr_db", label: "SNR", unit: "dB", val: rec.snr_db ?? meta.snr_db },
    { key: "sigmos_ovrl", label: "SigMOS Overall", val: meta.sigmos_ovrl },
    { key: "srmr", label: "SRMR", val: meta.srmr },
    { key: "rms_dbfs", label: "RMS Level", unit: "dBFS", val: meta.rms_dbfs },
    { key: "wvmos", label: "WVMOS", val: meta.wvmos },
    { key: "vqscore", label: "VQScore", val: meta.vqscore },
    { key: "sigmos_reverb", label: "SigMOS Reverb", val: meta.sigmos_reverb },
    { key: "sigmos_disc", label: "SigMOS Disc", val: meta.sigmos_disc },
  ].filter((m) => m.val !== null && m.val !== undefined);

  const tierColors: Record<string, string> = {
    PQ: "bg-blue-600 text-white border-blue-700",
    HQ: "bg-emerald-600 text-white border-emerald-700",
    MQ: "bg-amber-500 text-white border-amber-600",
    LQ: "bg-red-600 text-white border-red-700",
  };

  const tierLabels: Record<string, string> = {
    PQ: "Premium Quality", HQ: "High Quality", MQ: "Medium Quality", LQ: "Low Quality",
  };

  return (
    <div className="max-w-5xl mx-auto pb-32">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[14px] text-[hsl(var(--muted-foreground))] mb-6">
        <button onClick={() => navigate(`/audit/audio/validation/${campaignId}`)} className="hover:text-[hsl(var(--foreground))]">
          Validação
        </button>
        <ChevronRight className="h-4 w-4" />
        <span className="text-[hsl(var(--foreground))] font-medium truncate">{rec.discord_username || rec.filename}</span>
      </div>

      {/* BLOCO A — Identification */}
      <div className="bg-white rounded-2xl border border-[hsl(var(--border))] p-7 mb-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-[26px] font-bold text-[hsl(var(--foreground))] mb-1">
              {rec.discord_username || rec.filename}
            </h1>
            <p className="text-[15px] text-[hsl(var(--muted-foreground))]">{campaignName}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={rec.quality_status || "pending"} />
            {tier && (
              <span className={cn("text-[14px] font-bold px-3 py-1.5 rounded-lg border", tierColors[tier])}>
                {tier} — {tierLabels[tier]}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Mic2, label: "Sessão", value: rec.session_id?.slice(0, 8) || "—" },
            { icon: Clock, label: "Duração", value: formatTime(rec.duration_seconds || 0) },
            { icon: Globe, label: "Data", value: new Date(rec.created_at).toLocaleString("pt-BR") },
            { icon: User, label: "Tipo", value: rec.recording_type || "—" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[hsl(var(--muted))] flex items-center justify-center">
                <item.icon className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </div>
              <div>
                <p className="text-[12px] text-[hsl(var(--muted-foreground))] uppercase font-semibold">{item.label}</p>
                <p className="text-[16px] font-semibold text-[hsl(var(--foreground))]">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* BLOCO C — Tracks with per-track player & metrics */}
      {siblings.length > 0 && (
        <div className="space-y-6 mb-6">
          <h2 className="text-[20px] font-bold text-[hsl(var(--foreground))]">
            {siblings.length > 1 ? "Trilhas da Sessão" : "Áudio & Métricas"}
          </h2>
          {siblings.map((sib) => {
            const isCurrentRec = sib.id === rec.id;
            const sibUrl = (sib.metadata as any)?.enhanced_file_url || sib.file_url;
            const sibMeta = sib.metadata || {};
            const sibTier = typeof sibMeta.quality_tier === "string" ? sibMeta.quality_tier.toUpperCase() : undefined;
            const sibMetrics = [
              { key: "snr_db", label: "SNR", unit: "dB", val: sib.snr_db ?? sibMeta.snr_db },
              { key: "sigmos_ovrl", label: "SigMOS Overall", val: sibMeta.sigmos_ovrl },
              { key: "srmr", label: "SRMR", val: sibMeta.srmr },
              { key: "rms_dbfs", label: "RMS Level", unit: "dBFS", val: sibMeta.rms_dbfs },
              { key: "wvmos", label: "WVMOS", val: sibMeta.wvmos },
              { key: "vqscore", label: "VQScore", val: sibMeta.vqscore },
              { key: "sigmos_reverb", label: "SigMOS Reverb", val: sibMeta.sigmos_reverb },
              { key: "sigmos_disc", label: "SigMOS Disc", val: sibMeta.sigmos_disc },
            ].filter((m) => m.val !== null && m.val !== undefined);

            return (
              <div
                key={sib.id}
                className={cn(
                  "bg-white rounded-2xl border p-6 transition-all",
                  isCurrentRec
                    ? "border-[hsl(var(--primary))]/40 ring-2 ring-[hsl(var(--primary))]/20"
                    : "border-[hsl(var(--border))]"
                )}
              >
                {/* Track header */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="h-10 w-10 rounded-xl bg-[hsl(var(--muted))] flex items-center justify-center shrink-0">
                    <Headphones className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[15px] font-semibold text-[hsl(var(--foreground))] truncate">
                        {sib.recording_type === "mixed" ? "Mixed" :
                         sib.recording_type === "individual" ? (sib.discord_username || "Speaker") :
                         sib.recording_type || sib.filename}
                        {isCurrentRec && <span className="text-[hsl(var(--primary))] ml-2">(atual)</span>}
                      </p>
                      {sibTier && (
                        <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-md uppercase", tierColors[sibTier] || "bg-gray-600 text-white")}>
                          {sibTier} — {tierLabels[sibTier] || sibTier}
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                      {formatTime(sib.duration_seconds || 0)}
                    </p>
                  </div>
                  {sibUrl && !isCurrentRec && (
                    <button
                      onClick={() => navigate(`/audit/audio/validation/${campaignId}/${sib.id}`)}
                      className="text-[14px] font-medium text-[hsl(var(--primary))] hover:underline shrink-0"
                    >
                      Abrir
                    </button>
                  )}
                </div>

                {/* Inline audio player */}
                {sibUrl && (
                  <div className="mb-4">
                    <audio
                      controls
                      src={sibUrl}
                      className="w-full h-10 rounded-lg"
                      preload="none"
                    />
                  </div>
                )}

                {/* Per-track metrics */}
                {sibMetrics.length > 0 && (
                  <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                    {sibMetrics.map((m) => (
                      <MetricCard
                        key={m.key}
                        label={m.label}
                        value={typeof m.val === "number" ? Number(m.val).toFixed(2) : String(m.val)}
                        unit={m.unit}
                        tier={sibTier}
                        tooltip={metricTooltips[m.key]}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* BLOCO E — Technical Actions */}
      <div className="bg-white rounded-2xl border border-[hsl(var(--border))] p-7 mb-6">
        <h2 className="text-[20px] font-bold text-[hsl(var(--foreground))] mb-5">
          Ações Técnicas
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleReanalyze}
            className="h-13 px-6 text-[15px] rounded-xl gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <RefreshCw className="h-5 w-5" />
            Reanalisar
          </Button>
          <Button
            onClick={handleEnhance}
            className="h-13 px-6 text-[15px] rounded-xl gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Sparkles className="h-5 w-5" />
            Enhance
          </Button>
        </div>
      </div>

      {/* BLOCO F — Decision Panel (sticky) */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <div className="max-w-5xl mx-auto px-6 md:px-8">
          <div className="bg-white border border-[hsl(var(--border))] rounded-t-2xl shadow-lg px-7 py-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <StatusBadge status={rec.quality_status || "pending"} />
              <span className="text-[15px] text-[hsl(var(--muted-foreground))]">
                {rec.discord_username || rec.filename}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Button
                className={cn(
                  "h-13 px-6 text-[15px] rounded-xl gap-2 text-white",
                  meta.flagged_for_review
                    ? "bg-amber-500 hover:bg-amber-600"
                    : "bg-slate-600 hover:bg-slate-700"
                )}
                onClick={handleToggleFlag}
                disabled={saving}
              >
                <Bookmark className={cn("h-5 w-5", meta.flagged_for_review && "fill-current")} />
                {meta.flagged_for_review ? "Flagged" : "Flag p/ revisão"}
              </Button>
              <Button
                className="h-13 px-6 text-[15px] rounded-xl gap-2 bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setShowRejectModal(true)}
                disabled={saving}
              >
                <XCircle className="h-5 w-5" />
                Reprovar
              </Button>
              <Button
                className="h-13 px-8 text-[15px] rounded-xl gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
                onClick={handleApprove}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                Aprovar
              </Button>
              <Button
                className="h-13 px-6 text-[15px] rounded-xl gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => navigate(`/audit/audio/validation/${campaignId}`)}
              >
                <SkipForward className="h-5 w-5" />
                Próximo
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Rejection Modal */}
      <RejectionReasonModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        onConfirm={handleReject}
        campaignId={campaignId || ""}
      />
    </div>
  );
}
