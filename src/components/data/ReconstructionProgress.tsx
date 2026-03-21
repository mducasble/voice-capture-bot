import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, Wand2, Mic2, Cog } from "lucide-react";

export type ReconstructionStep = "idle" | "transcribing" | "transcribing_poll" | "separating" | "separating_poll" | "done";

interface ReconstructionProgressProps {
  step: ReconstructionStep;
  pollAttempt?: number;
  pollMax?: number;
  targetName?: string;
}

const stepConfig: Record<ReconstructionStep, { label: string; icon: React.ElementType; color: string; percent: number }> = {
  idle: { label: "Preparando...", icon: Cog, color: "blue", percent: 0 },
  transcribing: { label: "Etapa 1/2: Transcrevendo mixed", icon: Mic2, color: "blue", percent: 15 },
  transcribing_poll: { label: "Etapa 1/2: Aguardando transcrição", icon: Loader2, color: "amber", percent: 30 },
  separating: { label: "Etapa 2/2: Separando speakers", icon: Wand2, color: "violet", percent: 65 },
  separating_poll: { label: "Etapa 2/2: Aguardando separação", icon: Loader2, color: "violet", percent: 75 },
  done: { label: "Concluído!", icon: CheckCircle2, color: "emerald", percent: 100 },
};

export function ReconstructionProgress({ step, pollAttempt, pollMax, targetName }: ReconstructionProgressProps) {
  if (step === "idle") return null;

  const cfg = stepConfig[step];
  const Icon = cfg.icon;
  const isPolling = step === "transcribing_poll" || step === "separating_poll";

  let progressValue = cfg.percent;
  if (isPolling && pollAttempt && pollMax) {
    const nextStep = step === "transcribing_poll" ? stepConfig.separating : stepConfig.done;
    const range = nextStep.percent - cfg.percent;
    progressValue = cfg.percent + (pollAttempt / pollMax) * range;
  }

  const colorMap: Record<string, { bg: string; border: string; text: string; bar: string }> = {
    blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400", bar: "[&>div]:bg-blue-500" },
    amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", bar: "[&>div]:bg-amber-500" },
    violet: { bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400", bar: "[&>div]:bg-violet-500" },
    emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", bar: "[&>div]:bg-emerald-500" },
  };

  const c = colorMap[cfg.color] || colorMap.blue;

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4 space-y-3 animate-fade-in`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icon className={`h-4 w-4 ${c.text} ${step !== "done" ? "animate-spin" : ""}`} />
          <span className={`text-sm font-medium ${c.text}`}>{cfg.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {targetName && (
            <span className="text-xs text-muted-foreground">{targetName}</span>
          )}
          <span className="text-xs font-mono text-muted-foreground">
            {Math.round(progressValue)}%
          </span>
        </div>
      </div>

      <Progress value={progressValue} className={`h-2 ${c.bar}`} />

      {isPolling && pollAttempt && pollMax && (
        <p className="text-xs text-muted-foreground text-center">
          Tentativa {pollAttempt}/{pollMax} — aguardando backend...
        </p>
      )}
    </div>
  );
}