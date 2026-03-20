import { useState } from "react";
import {
  Loader2, Headphones, RefreshCw, Sparkles, Zap, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/audit/MetricCard";
import { cn } from "@/lib/utils";

const tierColors: Record<string, string> = {
  PQ: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  HQ: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  MQ: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  LQ: "bg-red-500/20 text-red-400 border-red-500/30",
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

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

interface TrackCardProps {
  sib: any;
  isMain: boolean;
  hasEnhanced: boolean;
  enhancedUrl: string | null;
  originalUrl: string | null;
  sibTier: string | undefined;
  enhancedTier: string | undefined;
  sibMetrics: { key: string; label: string; unit?: string; val: any }[];
  enhancedMetrics: { key: string; label: string; unit?: string; val: any }[];
  analyzeQueued: boolean;
  enhanceQueued: boolean;
  logAction: (action: string, detail?: string) => void;
  handleReanalyze: (id: string) => void;
  handleEnhance: (id: string) => void;
  selectedVersion: "original" | "enhanced";
  onSelectVersion: (id: string, version: "original" | "enhanced") => void;
}

export function TrackCard({
  sib, isMain, hasEnhanced, enhancedUrl, originalUrl,
  sibTier, enhancedTier, sibMetrics, enhancedMetrics,
  analyzeQueued, enhanceQueued,
  logAction, handleReanalyze, handleEnhance,
  selectedVersion, onSelectVersion,
}: TrackCardProps) {
  const [playingEnhanced, setPlayingEnhanced] = useState(hasEnhanced);

  const activeUrl = playingEnhanced && enhancedUrl ? enhancedUrl : originalUrl;
  const showingEnhancedMetrics = playingEnhanced && enhancedMetrics.length > 0;
  const displayMetrics = showingEnhancedMetrics ? enhancedMetrics : sibMetrics;
  const displayTier = showingEnhancedMetrics ? enhancedTier : sibTier;

  return (
    <div
      className={cn(
        "data-glass-card rounded-2xl p-5 transition-all",
        isMain && "ring-1 ring-white/[0.15]"
      )}
    >
      {/* Track header */}
      <div className="flex items-center gap-4 mb-4">
        <div className="h-10 w-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
          <Headphones className="h-5 w-5 text-white/40" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-semibold text-white truncate">
              {sib.recording_type === "mixed" ? "Mixed" :
               sib.recording_type === "individual" ? (sib.discord_username || "Speaker") :
               sib.recording_type || sib.filename}
              {isMain && <span className="text-white/30 ml-2 text-[13px]">(principal)</span>}
            </p>
            {displayTier && (
              <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-md border", tierColors[displayTier] || "bg-white/10 text-white/50 border-white/10")}>
                {displayTier}
              </span>
            )}
            {hasEnhanced && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md border bg-violet-500/20 text-violet-400 border-violet-500/30 flex items-center gap-1">
                <Zap className="h-3 w-3" /> Enhanced
              </span>
            )}
          </div>
          <p className="text-[13px] text-white/30">
            {formatTime(sib.duration_seconds || 0)}
          </p>
        </div>
      </div>

      {/* Toggle Original / Enhanced */}
      {hasEnhanced && (
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06] w-fit">
            <button
              onClick={() => { setPlayingEnhanced(false); logAction("toggle_original", sib.id); }}
              className={cn(
                "px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all",
                !playingEnhanced
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-white/40 hover:text-white/60"
              )}
            >
              Original
            </button>
            <button
              onClick={() => { setPlayingEnhanced(true); logAction("toggle_enhanced", sib.id); }}
              className={cn(
                "px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all flex items-center gap-1",
                playingEnhanced
                  ? "bg-violet-500/20 text-violet-300 shadow-sm"
                  : "text-white/40 hover:text-white/60"
              )}
            >
              <Zap className="h-3 w-3" /> Enhanced
            </button>
          </div>

          {/* Version selector for submission */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06] w-fit ml-auto">
            <span className="text-[11px] text-white/30 px-2 uppercase tracking-wider font-semibold">Enviar:</span>
            <button
              onClick={() => { onSelectVersion(sib.id, "original"); logAction("select_original", sib.id); }}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1",
                selectedVersion === "original"
                  ? "bg-emerald-500/20 text-emerald-400 shadow-sm"
                  : "text-white/40 hover:text-white/60"
              )}
            >
              {selectedVersion === "original" && <Check className="h-3 w-3" />}
              Original
            </button>
            <button
              onClick={() => { onSelectVersion(sib.id, "enhanced"); logAction("select_enhanced", sib.id); }}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1",
                selectedVersion === "enhanced"
                  ? "bg-violet-500/20 text-violet-400 shadow-sm"
                  : "text-white/40 hover:text-white/60"
              )}
            >
              {selectedVersion === "enhanced" && <Check className="h-3 w-3" />}
              Enhanced
            </button>
          </div>
        </div>
      )}

      {/* Player */}
      {activeUrl && (
        <div className="mb-4">
          <audio
            key={activeUrl}
            controls
            src={activeUrl}
            className="w-full h-10"
            preload="none"
            onPlay={() => logAction("play", `${sib.recording_type || sib.id}${playingEnhanced ? "_enhanced" : ""}`)}
            onPause={() => logAction("pause", sib.recording_type || sib.id)}
            onSeeked={() => logAction("seek", sib.recording_type || sib.id)}
          />
        </div>
      )}

      {/* Per-track metrics */}
      {displayMetrics.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {displayMetrics.map((m) => (
            <MetricCard
              key={m.key}
              metricKey={m.key}
              label={m.label}
              value={typeof m.val === "number" ? Number(m.val).toFixed(2) : String(m.val)}
              unit={m.unit}
              tier={displayTier}
              tooltip={metricTooltips[m.key]}
            />
          ))}
        </div>
      )}

      {/* Per-track actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={analyzeQueued}
          onClick={() => handleReanalyze(sib.id)}
          className={cn(
            "h-8 px-3 text-[13px] rounded-lg gap-1.5",
            analyzeQueued
              ? "bg-emerald-900/40 text-emerald-400/60 cursor-default"
              : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/20"
          )}
        >
          {analyzeQueued ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando...</>
          ) : (
            <><RefreshCw className="h-3.5 w-3.5" /> Reanalisar</>
          )}
        </Button>
        <Button
          size="sm"
          disabled={enhanceQueued}
          onClick={() => handleEnhance(sib.id)}
          className={cn(
            "h-8 px-3 text-[13px] rounded-lg gap-1.5",
            enhanceQueued
              ? "bg-blue-900/40 text-blue-400/60 cursor-default"
              : "bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/20"
          )}
        >
          {enhanceQueued ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processando...</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5" /> Enhance</>
          )}
        </Button>
      </div>
    </div>
  );
}
