import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCallback, useRef, useState, useEffect } from "react";

interface SessionTranscriptionResult {
  success: boolean;
  session_id?: string;
  transcription?: string;
  speakers?: { username: string; user_id: string; has_transcription: boolean }[];
  stats?: { total_tracks: number; transcribed: number; failed: number };
  status?: string;
  message?: string;
  error?: string;
  processed?: number;
  pending?: number;
}

interface WaitingState {
  mixedRecordingId?: string;
  sessionId?: string;
  message?: string;
  retryAt: number; // timestamp when retry will happen
}

// Global state for waiting recordings (shared across hook instances)
const waitingRecordings = new Map<string, WaitingState>();
const waitingListeners = new Set<() => void>();

function notifyWaitingListeners() {
  waitingListeners.forEach(listener => listener());
}

export function useWaitingState(mixedRecordingId?: string) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!mixedRecordingId) return;

    const updateState = () => {
      const state = waitingRecordings.get(mixedRecordingId);
      if (state) {
        const remaining = Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000));
        setCountdown(remaining);
        setMessage(state.message || null);
      } else {
        setCountdown(null);
        setMessage(null);
      }
    };

    updateState();
    waitingListeners.add(updateState);

    const interval = setInterval(updateState, 1000);

    return () => {
      waitingListeners.delete(updateState);
      clearInterval(interval);
    };
  }, [mixedRecordingId]);

  return { countdown, message, isWaiting: countdown !== null && countdown > 0 };
}

export function useSessionTranscription() {
  const queryClient = useQueryClient();
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const mutation = useMutation({
    mutationFn: async ({ 
      sessionId, 
      mixedRecordingId 
    }: { 
      sessionId?: string; 
      mixedRecordingId?: string 
    }): Promise<SessionTranscriptionResult> => {
      const { data, error } = await supabase.functions.invoke('transcribe-session', {
        body: { 
          session_id: sessionId,
          mixed_recording_id: mixedRecordingId
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to aggregate session transcription');
      }

      return data as SessionTranscriptionResult;
    },
    onSuccess: (data, variables) => {
      console.log('Session transcription result:', data);
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
      
      const recordingKey = variables.mixedRecordingId || variables.sessionId || '';
      
      if (data.success) {
        // Clear waiting state on success
        waitingRecordings.delete(recordingKey);
        notifyWaitingListeners();
        
        if (data.status === 'processing') {
          toast.info("Processando transcrições...", {
            description: data.message || `${data.processed || 0} processadas, ${data.pending || 0} restantes`
          });
        } else {
          clearRetryTimeout();
          toast.success("Transcrição agregada!", {
            description: `${data.stats?.transcribed || 0} faixas com ${data.speakers?.length || 0} speakers identificados`
          });
        }
      } else if (data.status === 'waiting') {
        const retryDelay = 10000; // 10 seconds
        const retryAt = Date.now() + retryDelay;
        
        // Set waiting state
        waitingRecordings.set(recordingKey, {
          mixedRecordingId: variables.mixedRecordingId,
          sessionId: variables.sessionId,
          message: data.message,
          retryAt
        });
        notifyWaitingListeners();
        
        toast.info("Gerando chunks de áudio...", {
          description: "Retry automático em 10s"
        });
        
        clearRetryTimeout();
        retryTimeoutRef.current = setTimeout(() => {
          waitingRecordings.delete(recordingKey);
          notifyWaitingListeners();
          mutation.mutate(variables);
        }, retryDelay);
      } else if (data.error === 'no_individual_tracks') {
        waitingRecordings.delete(recordingKey);
        notifyWaitingListeners();
        toast.warning("Sem faixas individuais", {
          description: data.message
        });
      } else if (data.error === 'no_transcriptions') {
        waitingRecordings.delete(recordingKey);
        notifyWaitingListeners();
        toast.warning("Nenhuma transcrição disponível", {
          description: data.message || "As faixas individuais podem ser muito grandes (limite: 25MB)"
        });
      } else {
        waitingRecordings.delete(recordingKey);
        notifyWaitingListeners();
        toast.error("Erro na agregação", {
          description: data.message || data.error
        });
      }
    },
    onError: (error: Error, variables) => {
      const recordingKey = variables.mixedRecordingId || variables.sessionId || '';
      waitingRecordings.delete(recordingKey);
      notifyWaitingListeners();
      
      console.error('Session transcription error:', error);
      toast.error("Erro ao agregar transcrições", {
        description: error.message
      });
    }
  });

  return mutation;
}
