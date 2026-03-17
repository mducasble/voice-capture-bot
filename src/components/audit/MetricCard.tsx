import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricCardProps {
  label: string;
  value: string | number | null;
  unit?: string;
  status?: "good" | "fair" | "bad" | "neutral";
  tooltip?: string;
}

const statusStyles = {
  good: "border-emerald-200 bg-emerald-50",
  fair: "border-amber-200 bg-amber-50",
  bad: "border-red-200 bg-red-50",
  neutral: "border-[hsl(var(--border))] bg-white",
};

const statusText = {
  good: "text-emerald-700",
  fair: "text-amber-700",
  bad: "text-red-700",
  neutral: "text-[hsl(var(--foreground))]",
};

export function MetricCard({ label, value, unit, status = "neutral", tooltip }: MetricCardProps) {
  return (
    <div className={cn("rounded-xl border p-5 transition-all", statusStyles[status])}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {label}
        </span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-4 w-4 text-[hsl(var(--muted-foreground))]/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-[13px]">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className={cn("text-[24px] font-bold tabular-nums", statusText[status])}>
        {value !== null && value !== undefined ? value : "—"}
        {unit && <span className="text-[14px] font-medium ml-1 text-[hsl(var(--muted-foreground))]">{unit}</span>}
      </div>
    </div>
  );
}
