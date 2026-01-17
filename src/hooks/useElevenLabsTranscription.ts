import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ElevenLabsMode = 'chunks' | 'full';

export function useElevenLabsTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recordingId, mode = 'chunks' }: { recordingId: string; mode?: ElevenLabsMode }) => {
      const { data, error } = await supabase.functions.invoke('transcribe-elevenlabs', {
        body: {
          recording_id: recordingId,
          mode
        }
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onMutate: (variables) => {
      const modeLabel = variables.mode === 'full' ? 'WAV completo' : 'chunks';
      toast.loading(`Transcrevendo com ElevenLabs (${modeLabel})...`, { id: 'elevenlabs-transcription' });
    },
    onSuccess: () => {
      toast.success('Transcrição ElevenLabs concluída!', { id: 'elevenlabs-transcription' });
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    },
    onError: (error) => {
      console.error('ElevenLabs transcription error:', error);
      toast.error('Erro na transcrição ElevenLabs', { id: 'elevenlabs-transcription' });
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    }
  });
}
