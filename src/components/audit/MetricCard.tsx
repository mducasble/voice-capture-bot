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
  good: "border-emerald-700 bg-emerald-600",
  fair: "border-amber-600 bg-amber-500",
  bad: "border-red-700 bg-red-600",
  neutral: "border-gray-600 bg-gray-500",
};

const statusText = {
  good: "text-white",
  fair: "text-white",
  bad: "text-white",
  neutral: "text-white",
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
      <div className={cn("text-[22px] font-bold tabular-nums", statusText[status])}>
        {value !== null && value !== undefined ? value : "—"}
        {unit && <span className="text-[14px] font-medium ml-1 text-[hsl(var(--muted-foreground))]">{unit}</span>}
      </div>
    </div>
  );
}
