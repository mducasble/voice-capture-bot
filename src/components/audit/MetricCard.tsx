import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricCardProps {
  label: string;
  value: string | number | null;
  unit?: string;
  status?: "good" | "fair" | "bad" | "neutral";
  tier?: "PQ" | "HQ" | "MQ" | "LQ" | string;
  metricKey?: string;
  tooltip?: string;
}

function deriveStatus(metricKey: string | undefined, value: string | number | null): "good" | "fair" | "bad" | "neutral" {
  if (!metricKey || value == null) return "neutral";
  const v = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(v)) return "neutral";

  switch (metricKey) {
    case "snr_db":
      return v >= 30 ? "good" : v >= 25 ? "fair" : v >= 18 ? "bad" : "bad";
    case "sigmos_ovrl":
      return v >= 3.0 ? "good" : v >= 2.3 ? "fair" : "bad";
    case "srmr":
      return v >= 7.0 ? "good" : v >= 5.4 ? "fair" : v >= 4.0 ? "bad" : "bad";
    case "rms_dbfs":
      return v >= -24 ? "good" : v >= -26 ? "fair" : "bad";
    case "wvmos":
      return v >= 3.5 ? "good" : v >= 2.5 ? "fair" : "bad";
    case "vqscore":
      return v >= 0.65 ? "good" : v >= 0.5 ? "fair" : "bad";
    case "sigmos_reverb":
      return v >= 3.5 ? "good" : v >= 2.5 ? "fair" : "bad";
    case "sigmos_disc":
      return v >= 3.5 ? "good" : v >= 2.5 ? "fair" : "bad";
    default:
      return "neutral";
  }
}

const statusStyles: Record<string, string> = {
  good: "border-emerald-700 bg-emerald-600",
  fair: "border-amber-600 bg-amber-500",
  bad: "border-red-700 bg-red-600",
  neutral: "border-gray-600 bg-gray-500",
};

export function MetricCard({ label, value, unit, status, tier, metricKey, tooltip }: MetricCardProps) {
  // Priority: explicit status > per-metric derivation > tier fallback
  const resolved = status || deriveStatus(metricKey, value);
  const style = statusStyles[resolved] || statusStyles.neutral;

  return (
    <div className={cn("rounded-xl border px-4 py-3 transition-all flex items-center justify-between gap-2", style)}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-white/70 truncate">
          {label}
        </span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-white/50 cursor-help shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-[13px]">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="text-[18px] font-bold tabular-nums text-white whitespace-nowrap shrink-0">
        {value !== null && value !== undefined ? value : "—"}
        {unit && <span className="text-[12px] font-medium ml-0.5 text-white/60">{unit}</span>}
      </div>
    </div>
  );
}
