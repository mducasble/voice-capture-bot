import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricCardProps {
  label: string;
  value: string | number | null;
  unit?: string;
  status?: "good" | "fair" | "bad" | "neutral";
  tier?: "PQ" | "HQ" | "MQ" | "LQ" | string;
  tooltip?: string;
}

const tierStyles: Record<string, string> = {
  PQ: "border-blue-700 bg-blue-600",
  HQ: "border-emerald-700 bg-emerald-600",
  MQ: "border-amber-600 bg-amber-500",
  LQ: "border-red-700 bg-red-600",
};

const fallbackStyle = "border-gray-600 bg-gray-500";

export function MetricCard({ label, value, unit, tier, tooltip }: MetricCardProps) {
  const style = tier ? (tierStyles[tier] || fallbackStyle) : fallbackStyle;

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
