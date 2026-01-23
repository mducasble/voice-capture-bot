import { Progress } from "@/components/ui/progress";
import { Loader2, Cog } from "lucide-react";
import type { Recording } from "@/hooks/useRecordings";

interface ChunkGenerationProgressProps {
  recording: Recording;
}

interface ChunkProgress {
  chunks_completed: number;
  estimated_total: number;
  bytes_processed: number;
  total_bytes: number;
  updated_at: string;
}

export function ChunkGenerationProgress({ recording }: ChunkGenerationProgressProps) {
  // Only show for recordings in processing status
  if (recording.status !== 'processing') {
    return null;
  }

  const metadata = recording.metadata as { 
    chunk_generation_progress?: ChunkProgress;
  } | null;
  
  const progress = metadata?.chunk_generation_progress;
  
  // Show indeterminate state if no progress data yet
  if (!progress) {
    return (
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 animate-fade-in">
        <div className="flex items-center gap-2 text-sm text-blue-400">
          <Cog className="h-4 w-4 animate-spin" />
          <span className="font-medium">Iniciando processamento de áudio...</span>
        </div>
        <div className="mt-2 h-1.5 w-full bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-blue-500/50 animate-pulse" style={{ width: '100%' }} />
        </div>
      </div>
    );
  }

  const { chunks_completed, estimated_total, bytes_processed, total_bytes } = progress;
  const percentComplete = total_bytes > 0 ? Math.round((bytes_processed / total_bytes) * 100) : 0;
  const mbProcessed = (bytes_processed / 1024 / 1024).toFixed(0);
  const mbTotal = (total_bytes / 1024 / 1024).toFixed(0);

  return (
    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 space-y-2 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-blue-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-medium">Gerando chunks de áudio</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {chunks_completed}/{estimated_total} chunks
        </span>
      </div>
      
      <Progress value={percentComplete} className="h-2" />
      
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{mbProcessed} MB / {mbTotal} MB</span>
        <span className="font-mono">{percentComplete}%</span>
      </div>
    </div>
  );
}
