import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SessionTranscriptionResult {
  success: boolean;
  session_id?: string;
  transcription?: string;
  speakers?: { username: string; user_id: string; has_transcription: boolean }[];
  stats?: { total_tracks: number; transcribed: number; failed: number };
  status?: string;
  message?: string;
  error?: string;
}

export function useSessionTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
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
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Transcrição agregada!", {
          description: `${data.stats?.transcribed || 0} faixas com ${data.speakers?.length || 0} speakers identificados`
        });
        queryClient.invalidateQueries({ queryKey: ['recordings'] });
      } else if (data.status === 'waiting') {
        toast.info("Aguardando transcrições", {
          description: data.message
        });
      } else if (data.error === 'no_individual_tracks') {
        toast.warning("Sem faixas individuais", {
          description: data.message
        });
      } else {
        toast.error("Erro na agregação", {
          description: data.message || data.error
        });
      }
    },
    onError: (error: Error) => {
      console.error('Session transcription error:', error);
      toast.error("Erro ao agregar transcrições", {
        description: error.message
      });
    }
  });
}
