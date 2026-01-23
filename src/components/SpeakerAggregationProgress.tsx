import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, AlertTriangle, Clock, User } from "lucide-react";
import type { Recording } from "@/hooks/useRecordings";

interface SpeakerMeta {
  username: string;
  user_id: string;
  has_transcription: boolean;
  error?: string;
}

interface AggregationState {
  status: 'processing' | 'waiting' | 'completed' | 'failed';
  processed_count?: number;
  pending_count?: number;
  current_speaker?: string;
  current_chunk?: number;
  total_chunks?: number;
  speakers?: SpeakerMeta[];
  message?: string;
  updated_at?: string;
}

interface SpeakerAggregationProgressProps {
  recording: Recording;
}

export function SpeakerAggregationProgress({ recording }: SpeakerAggregationProgressProps) {
  const metadata = recording.metadata as { 
    aggregation_state?: AggregationState;
    speakers?: SpeakerMeta[];
    aggregated_at?: string;
  } | null;
  
  const aggregationState = metadata?.aggregation_state;
  const speakers = metadata?.speakers || aggregationState?.speakers;
  const aggregatedAt = metadata?.aggregated_at;
  
  // If no aggregation in progress and no completed aggregation, return null
  if (!aggregationState && !aggregatedAt) {
    return null;
  }

  // Completed state - show speaker summary
  if (aggregatedAt && !aggregationState) {
    const successful = speakers?.filter(s => s.has_transcription) || [];
    const failed = speakers?.filter(s => !s.has_transcription) || [];
    
    return (
      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span className="font-medium">Agregação concluída</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {new Date(aggregatedAt).toLocaleTimeString()}
          </span>
        </div>
        
        {speakers && speakers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {speakers.map((speaker) => (
              <Badge
                key={speaker.user_id}
                variant="outline"
                className={`text-xs flex items-center gap-1 ${
                  speaker.has_transcription
                    ? 'bg-green-500/10 text-green-400 border-green-500/30'
                    : 'bg-red-500/10 text-red-400 border-red-500/30'
                }`}
              >
                <User className="h-3 w-3" />
                {speaker.username}
                {speaker.has_transcription ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <span title={speaker.error}>
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Processing state
  if (aggregationState?.status === 'processing') {
    const processed = aggregationState.processed_count || 0;
    const pending = aggregationState.pending_count || 0;
    const total = processed + pending;
    const progressPercent = total > 0 ? (processed / total) * 100 : 0;
    
    return (
      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-purple-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-medium">Agregando por speaker...</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {processed}/{total} faixas
          </span>
        </div>
        
        <Progress value={progressPercent} className="h-2" />
        
        {aggregationState.current_speaker && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>Processando: <span className="text-purple-400">{aggregationState.current_speaker}</span></span>
            {aggregationState.current_chunk !== undefined && aggregationState.total_chunks !== undefined && (
              <span className="ml-auto">
                chunk {aggregationState.current_chunk + 1}/{aggregationState.total_chunks}
              </span>
            )}
          </div>
        )}
        
        {speakers && speakers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-purple-500/20">
            {speakers.map((speaker) => (
              <Badge
                key={speaker.user_id}
                variant="outline"
                className={`text-xs flex items-center gap-1 ${
                  speaker.has_transcription
                    ? 'bg-green-500/10 text-green-400 border-green-500/30'
                    : speaker.username === aggregationState.current_speaker
                    ? 'bg-purple-500/20 text-purple-400 border-purple-500/30 animate-pulse'
                    : 'bg-muted/50 text-muted-foreground border-border'
                }`}
              >
                <User className="h-3 w-3" />
                {speaker.username}
                {speaker.has_transcription ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : speaker.username === aggregationState.current_speaker ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Waiting state
  if (aggregationState?.status === 'waiting') {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm text-yellow-400">
          <Clock className="h-4 w-4" />
          <span className="font-medium">Aguardando processamento de áudio</span>
        </div>
        {aggregationState.message && (
          <p className="text-xs text-muted-foreground mt-1">{aggregationState.message}</p>
        )}
      </div>
    );
  }

  // Failed state
  if (aggregationState?.status === 'failed') {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-medium">Falha na agregação</span>
        </div>
        {aggregationState.message && (
          <p className="text-xs text-muted-foreground mt-1">{aggregationState.message}</p>
        )}
      </div>
    );
  }

  return null;
}
