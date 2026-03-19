import { useState } from "react";
import { useQueueMonitor } from "@/hooks/useQueueMonitor";
import { Loader2, ChevronDown, ChevronUp, Cpu, Sparkles, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

export function QueueProgressWidget() {
  const { jobs, totalPending, totalProcessing, estimatedMinutes, loading } = useQueueMonitor();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const totalActive = totalPending + totalProcessing;

  // Don't render if no active jobs or dismissed
  if (loading || totalActive === 0 || dismissed) return null;

  const processingJobs = jobs.filter((j) => j.status === "processing");
  const pendingJobs = jobs.filter((j) => j.status === "pending");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 animate-in slide-in-from-bottom-4 fade-in duration-300">
      {/* Collapsed bar */}
      <div
        className={cn(
          "bg-card border border-border rounded-xl shadow-2xl overflow-hidden",
          "backdrop-blur-sm"
        )}
      >
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                {totalActive}
              </span>
            </div>
            <div className="text-left">
              <span className="text-sm font-semibold text-foreground">
                Fila de Processamento
              </span>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>~{estimatedMinutes} min restante{estimatedMinutes !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDismissed(true);
              }}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Summary badges */}
        <div className="flex items-center gap-2 px-4 pb-3">
          {totalProcessing > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              <Loader2 className="h-3 w-3 animate-spin" />
              {totalProcessing} processando
            </span>
          )}
          {totalPending > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              {totalPending} na fila
            </span>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="border-t border-border max-h-64 overflow-y-auto">
            {processingJobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {pendingJobs.map((job, index) => (
              <JobRow key={job.id} job={job} queuePosition={index + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({ job, queuePosition }: { job: ReturnType<typeof useQueueMonitor>["jobs"][0]; queuePosition?: number }) {
  const isProcessing = job.status === "processing";
  const isEnhance = job.job_type === "enhance";
  const Icon = isEnhance ? Sparkles : Cpu;

  const progress =
    isProcessing && job.total_segments > 0
      ? Math.round((job.current_segment / job.total_segments) * 100)
      : isProcessing
        ? undefined // indeterminate
        : 0;

  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/30 transition-colors">
      <div
        className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          isProcessing ? "bg-primary/10" : "bg-muted"
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4",
            isEnhance ? "text-purple-400" : "text-emerald-400"
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-foreground truncate">
            {isEnhance ? "Enhance" : "Análise"}
          </span>
          {queuePosition && (
            <span className="text-[10px] text-muted-foreground font-mono">
              #{queuePosition} na fila
            </span>
          )}
          {isProcessing && progress !== undefined && (
            <span className="text-[10px] text-primary font-mono">
              {progress}%
            </span>
          )}
          {isProcessing && progress === undefined && (
            <Loader2 className="h-3 w-3 text-primary animate-spin" />
          )}
        </div>
        <span className="text-[10px] text-muted-foreground font-mono truncate block">
          {job.recording_id.slice(0, 8)}…
        </span>
        {isProcessing && progress !== undefined && (
          <Progress value={progress} className="h-1 mt-1" />
        )}
      </div>
    </div>
  );
}
