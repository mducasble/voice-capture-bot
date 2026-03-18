import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Upload, Play, Video, Hand, Eye, Sun,
  Focus, Activity, Shield, CheckCircle2, AlertTriangle,
  XCircle, Loader2, FileVideo, Clock, Maximize2,
  Volume2, BarChart3, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  runVideoQc,
  QcReport,
  QcProgress,
  DEFAULT_QC_CONFIG,
  type QcConfig,
} from "@/lib/videoQcEngine";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: QcReport["qcStatus"] }) {
  const map = {
    PASS: { icon: CheckCircle2, label: "PASS", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    WARNING: { icon: AlertTriangle, label: "WARNING", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    BLOCK: { icon: XCircle, label: "BLOCK", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const { icon: Icon, label, cls } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-bold border", cls)}>
      <Icon className="h-4 w-4" /> {label}
    </span>
  );
}

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 85 ? "hsl(142,70%,50%)" : score >= 65 ? "hsl(45,90%,55%)" : "hsl(0,75%,55%)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[32px] font-black text-white">{score}</span>
        <span className="text-[11px] text-white/40 font-medium -mt-1">/ 100</span>
      </div>
    </div>
  );
}

function MetricRow({ icon: Icon, label, value, unit, score }: {
  icon: any; label: string; value: string; unit?: string; score?: number;
}) {
  const barColor = score != null
    ? score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"
    : "bg-white/20";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="h-8 w-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-white/50" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-white/60">{label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[15px] font-semibold text-white">{value}</span>
          {unit && <span className="text-[12px] text-white/30">{unit}</span>}
        </div>
      </div>
      {score != null && (
        <div className="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${score}%` }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DataVideoTask() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const isStandalone = campaignId === "standalone";

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<QcProgress | null>(null);
  const [report, setReport] = useState<QcReport | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [handsOffTime, setHandsOffTime] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: campaign } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      if (!campaignId || isStandalone) return null;
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, description")
        .eq("id", campaignId)
        .single();
      return data;
    },
    enabled: !isStandalone,
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Selecione um arquivo de vídeo");
      return;
    }
    setFile(f);
    setVideoUrl(URL.createObjectURL(f));
    setReport(null);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;
    setAnalyzing(true);
    setReport(null);
    try {
      const result = await runVideoQc(file, DEFAULT_QC_CONFIG, setProgress);
      setReport(result);
      if (result.qcStatus === "PASS") {
        toast.success("Vídeo aprovado pelo QC!");
      } else if (result.qcStatus === "WARNING") {
        toast.warning("Vídeo com avisos de qualidade");
      } else {
        toast.error("Vídeo bloqueado pelo QC");
      }
    } catch (err) {
      console.error("[QC] Error:", err);
      toast.error("Erro na análise: " + (err as Error).message);
    }
    setAnalyzing(false);
  }, [file]);

  const progressPercent = progress
    ? progress.total > 0 ? (progress.current / progress.total) * 100 : 0
    : 0;

  // Hands-off-screen timer: sync with video playback using analyzed frames
  useEffect(() => {
    if (!report || !videoRef.current) return;
    const video = videoRef.current;
    let rafId: number;

    const update = () => {
      const t = video.currentTime;
      // Count how many seconds of analyzed time have no hands up to current time
      let offSeconds = 0;
      const interval = report.duration / report.analyzedFrames;
      for (const frame of report.frames) {
        if (frame.time > t) break;
        if (frame.handsDetected === 0) {
          offSeconds += interval;
        }
      }
      setHandsOffTime(offSeconds);
      rafId = requestAnimationFrame(update);
    };

    const start = () => { rafId = requestAnimationFrame(update); };
    const stop = () => cancelAnimationFrame(rafId);

    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", () => update());

    // If already playing
    if (!video.paused) start();

    return () => {
      stop();
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", () => update());
    };
  }, [report]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <button onClick={() => navigate(`/data/video/campaigns`)}
        className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <div className="flex items-center gap-3 mb-8">
        <div className="h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
          <Shield className="h-6 w-6 text-purple-400" />
        </div>
        <div>
          <h1 className="text-[24px] md:text-[28px] font-bold text-white tracking-tight">
            Video QC Analysis
          </h1>
          {campaign && <p className="text-[14px] text-white/40">{campaign.name}</p>}
          {isStandalone && <p className="text-[14px] text-white/40">Análise individual</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Upload + Video Player */}
        <div className="lg:col-span-3 space-y-5">
          {/* Upload area */}
          {!videoUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="group cursor-pointer border-2 border-dashed border-white/[0.08] hover:border-white/[0.16] rounded-3xl p-12 text-center transition-all hover:bg-white/[0.02]"
            >
              <div className="h-20 w-20 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-5">
                <Upload className="h-10 w-10 text-white/30 group-hover:text-white/60 transition-colors" />
              </div>
              <p className="text-[18px] font-semibold text-white/70 mb-1">Arraste um vídeo ou clique para selecionar</p>
              <p className="text-[14px] text-white/30">MP4, MOV, WebM — até 10GB</p>
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
            </div>
          ) : (
            <>
              {/* Video player */}
              <div className="relative rounded-2xl overflow-hidden bg-black/40 border border-white/[0.06]">
                <video ref={videoRef} src={videoUrl} controls className="w-full max-h-[400px] object-contain" />
                {report && (
                  <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2 pointer-events-none">
                    <Hand className="h-4 w-4 text-amber-400" />
                    <div className="text-right">
                      <p className="text-[10px] text-white/40 leading-none">Mãos fora</p>
                      <p className="text-[16px] font-mono font-bold text-amber-400 leading-tight">{handsOffTime.toFixed(1)}s</p>
                    </div>
                  </div>
                )}
              </div>

              {/* File info */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[13px] text-white/50 flex items-center gap-1.5">
                  <FileVideo className="h-3.5 w-3.5" /> {file?.name}
                </span>
                <span className="text-[13px] text-white/30">
                  {((file?.size || 0) / 1024 / 1024).toFixed(1)} MB
                </span>
                <button onClick={() => { setFile(null); setVideoUrl(null); setReport(null); }}
                  className="text-[13px] text-red-400/70 hover:text-red-400 transition-colors ml-auto">
                  Remover
                </button>
              </div>

              {/* Analyze button */}
              {!report && (
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="w-full h-14 text-[16px] font-bold rounded-2xl bg-purple-600 hover:bg-purple-500 transition-colors"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      {progress?.message || "Analisando..."}
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5 mr-2" />
                      Iniciar Análise QC
                    </>
                  )}
                </Button>
              )}

              {/* Progress bar */}
              {analyzing && progress && (
                <div className="space-y-2">
                  <Progress value={progressPercent} className="h-2" />
                  <p className="text-[12px] text-white/30 text-center">
                    {progress.current}/{progress.total} — {progress.message}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Detailed metrics */}
          {report && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <button onClick={() => setShowDetails(!showDetails)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors">
                <span className="text-[16px] font-semibold text-white flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-white/40" />
                  Métricas Detalhadas
                </span>
                {showDetails ? <ChevronUp className="h-5 w-5 text-white/30" /> : <ChevronDown className="h-5 w-5 text-white/30" />}
              </button>

              {showDetails && (
                <div className="px-6 pb-5 space-y-6">
                  {/* File section */}
                  <div>
                    <h4 className="text-[12px] font-bold text-white/30 uppercase tracking-wider mb-2">Arquivo</h4>
                    <MetricRow icon={Clock} label="Duração" value={`${report.duration.toFixed(1)}s`} />
                    <MetricRow icon={Maximize2} label="Resolução" value={`${report.width}×${report.height}`} unit={report.orientation} />
                    <MetricRow icon={Activity} label="FPS Análise" value={`${report.fps}`} unit="fps" />
                    <MetricRow icon={Volume2} label="Áudio" value={report.hasAudio ? "Sim" : "Não"} />
                    <MetricRow icon={FileVideo} label="Tamanho" value={`${(report.fileSize / 1024 / 1024).toFixed(1)}`} unit="MB" />
                  </div>

                  {/* Hands section */}
                  <div>
                    <h4 className="text-[12px] font-bold text-white/30 uppercase tracking-wider mb-2">Mãos</h4>
                    <MetricRow icon={Hand} label="Presença de mãos" value={`${(report.handPresenceRate * 100).toFixed(0)}%`} score={report.handPresenceRate * 100} />
                    <MetricRow icon={Hand} label="Duas mãos" value={`${(report.dualHandRate * 100).toFixed(0)}%`} score={report.dualHandRate * 100} />
                    <MetricRow icon={Focus} label="Centralização" value={`${report.handCenteringScore.toFixed(0)}`} unit="/100" score={report.handCenteringScore} />
                    <MetricRow icon={Maximize2} label="Tamanho da mão" value={`${report.handSizeScore.toFixed(0)}`} unit="/100" score={report.handSizeScore} />
                    <MetricRow icon={Activity} label="Continuidade" value={`${report.trackingContinuityScore.toFixed(0)}`} unit="/100" score={report.trackingContinuityScore} />
                  </div>

                  {/* Face section */}
                  <div>
                    <h4 className="text-[12px] font-bold text-white/30 uppercase tracking-wider mb-2">Rosto (Privacidade)</h4>
                    <MetricRow icon={Eye} label="Presença de rosto" value={`${(report.facePresenceRate * 100).toFixed(0)}%`}
                      score={(1 - report.facePresenceRate) * 100} />
                    <MetricRow icon={Clock} label="Máx. duração rosto" value={`${report.maxFaceDuration.toFixed(1)}s`} />
                  </div>

                  {/* Quality section */}
                  <div>
                    <h4 className="text-[12px] font-bold text-white/30 uppercase tracking-wider mb-2">Qualidade</h4>
                    <MetricRow icon={Focus} label="Nitidez (blur)" value={`${report.blurScore.toFixed(0)}`} unit="/100" score={report.blurScore} />
                    <MetricRow icon={Sun} label="Iluminação" value={`${report.brightnessScore.toFixed(0)}`} unit="/100" score={report.brightnessScore} />
                    <MetricRow icon={Activity} label="Estabilidade" value={`${report.stabilityScore.toFixed(0)}`} unit="/100" score={report.stabilityScore} />
                  </div>

                  {/* Analyzed frames */}
                  <p className="text-[12px] text-white/20 text-center">
                    {report.analyzedFrames} frames analisados de ~{report.totalFrames} estimados
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: QC Summary */}
        <div className="lg:col-span-2 space-y-5">
          {report ? (
            <>
              {/* Score card */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center">
                <StatusBadge status={report.qcStatus} />
                <div className="mt-5">
                  <ScoreRing score={report.qcScore} />
                </div>
                <p className="text-[13px] text-white/40 mt-3">Quality Score</p>
              </div>

              {/* Failure/warning reasons */}
              {report.failureReasons.length > 0 && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-5 space-y-2">
                  <h4 className="text-[13px] font-bold text-red-400 flex items-center gap-1.5">
                    <XCircle className="h-4 w-4" /> Bloqueios
                  </h4>
                  {report.failureReasons.map((r, i) => (
                    <p key={i} className="text-[13px] text-red-300/70">{r}</p>
                  ))}
                </div>
              )}

              {report.warningReasons.length > 0 && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-5 space-y-2">
                  <h4 className="text-[13px] font-bold text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" /> Avisos
                  </h4>
                  {report.warningReasons.map((r, i) => (
                    <p key={i} className="text-[13px] text-amber-300/70">{r}</p>
                  ))}
                </div>
              )}

              {/* Key metrics summary */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-1">
                <h4 className="text-[12px] font-bold text-white/30 uppercase tracking-wider mb-3">Resumo</h4>
                <MetricRow icon={Hand} label="Mãos" value={`${(report.handPresenceRate * 100).toFixed(0)}%`} score={report.handPresenceRate * 100} />
                <MetricRow icon={Eye} label="Sem rosto" value={`${((1 - report.facePresenceRate) * 100).toFixed(0)}%`} score={(1 - report.facePresenceRate) * 100} />
                <MetricRow icon={Focus} label="Nitidez" value={`${report.blurScore.toFixed(0)}`} score={report.blurScore} />
                <MetricRow icon={Sun} label="Luz" value={`${report.brightnessScore.toFixed(0)}`} score={report.brightnessScore} />
                <MetricRow icon={Activity} label="Estabilidade" value={`${report.stabilityScore.toFixed(0)}`} score={report.stabilityScore} />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  onClick={() => { setFile(null); setVideoUrl(null); setReport(null); }}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl border-white/[0.08] text-white/70 hover:bg-white/[0.06]"
                >
                  Novo vídeo
                </Button>
                <Button
                  onClick={handleAnalyze}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl border-white/[0.08] text-white/70 hover:bg-white/[0.06]"
                >
                  Re-analisar
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
              <Video className="h-16 w-16 text-white/10 mx-auto mb-4" />
              <p className="text-[16px] text-white/30 font-medium">
                {file ? "Clique em \"Iniciar Análise\" para processar" : "Faça upload de um vídeo para começar"}
              </p>
              <p className="text-[13px] text-white/15 mt-2">
                MediaPipe Hands + Face Detection + Blur + Lighting
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
