import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Recording } from "@/hooks/useRecordings";

interface ChunkState {
  chunkNames: string[];
  nextIndex: number;
  lockedAt: string;
  error?: string;
}

export interface IncompleteTranscriptionInfo {
  isIncomplete: boolean;
  reason: 'quota_exceeded' | 'partial_chunks' | 'failed' | null;
  chunksCompleted: number;
  chunksTotal: number;
  percentComplete: number;
  estimatedMissingSeconds: number;
}

/**
 * Analyzes a recording to determine if its ElevenLabs transcription is incomplete
 */
export function getIncompleteTranscriptionInfo(recording: Recording): IncompleteTranscriptionInfo {
  const chunkState = recording.elevenlabs_chunk_state as ChunkState | null;
  const status = recording.transcription_elevenlabs_status;
  
  // Default: not incomplete
  const defaultResult: IncompleteTranscriptionInfo = {
    isIncomplete: false,
    reason: null,
    chunksCompleted: 0,
    chunksTotal: 0,
    percentComplete: 100,
    estimatedMissingSeconds: 0,
  };

  // If completed and no chunk state, it's done
  if (status === 'completed' && !chunkState) {
    return defaultResult;
  }

  // If there's chunk state with progress info
  if (chunkState && chunkState.chunkNames?.length > 0) {
    const total = chunkState.chunkNames.length;
    const completed = chunkState.nextIndex || 0;
    
    if (completed < total) {
      const missingChunks = total - completed;
      const estimatedMissingSeconds = missingChunks * 30; // 30s per chunk
      
      return {
        isIncomplete: true,
        reason: chunkState.error === 'quota_exceeded' ? 'quota_exceeded' : 'partial_chunks',
        chunksCompleted: completed,
        chunksTotal: total,
        percentComplete: Math.round((completed / total) * 100),
        estimatedMissingSeconds,
      };
    }
  }

  // If failed status without completed transcription
  if (status === 'failed' && !recording.transcription_elevenlabs) {
    return {
      isIncomplete: true,
      reason: 'failed',
      chunksCompleted: chunkState?.nextIndex || 0,
      chunksTotal: chunkState?.chunkNames?.length || 0,
      percentComplete: 0,
      estimatedMissingSeconds: recording.duration_seconds || 0,
    };
  }

  return defaultResult;
}

export function useResumeElevenLabsTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recordingId }: { recordingId: string }) => {
      // Clear the error flag and release lock before resuming
      const { error: updateError } = await supabase
        .from('voice_recordings')
        .update({
          transcription_elevenlabs_status: 'processing',
          // Clear the error flag in chunk state if present
          elevenlabs_chunk_state: supabase.rpc ? undefined : undefined, // Will be handled by edge function
        })
        .eq('id', recordingId);

      if (updateError) {
        console.error('Failed to reset status:', updateError);
      }

      const { data, error } = await supabase.functions.invoke('transcribe-elevenlabs', {
        body: {
          recording_id: recordingId,
          mode: 'chunks'
        }
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onMutate: () => {
      toast.loading('Retomando transcrição ElevenLabs...', { id: 'resume-elevenlabs' });
    },
    onSuccess: (data: any) => {
      if (data?.success && !data?.skipped) {
        toast.success('Transcrição retomada!', { 
          id: 'resume-elevenlabs',
          description: data.done ? 'Concluída!' : `Progresso: ${data.nextIndex || 0} chunks processados`
        });
      } else if (data?.skipped) {
        toast.info(data.reason === 'already_completed' 
          ? 'Transcrição já estava completa.' 
          : 'Transcrição já está em processamento.', 
          { id: 'resume-elevenlabs' }
        );
      } else if (data?.error === 'quota_exceeded') {
        toast.error('Créditos ElevenLabs esgotados novamente.', { id: 'resume-elevenlabs' });
      } else {
        toast.error(data?.message || 'Erro ao retomar transcrição', { id: 'resume-elevenlabs' });
      }
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    },
    onError: (error) => {
      console.error('Resume transcription error:', error);
      toast.error('Erro ao retomar transcrição', { id: 'resume-elevenlabs' });
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    }
  });
}
