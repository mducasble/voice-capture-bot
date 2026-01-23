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
    onSuccess: (data: any) => {
      if (data?.success && data?.scheduled_processing) {
        toast.message('Processamento iniciado — a transcrição vai começar em seguida.', { id: 'elevenlabs-transcription' });
      } else if (data?.success && !data?.skipped) {
        toast.success('Transcrição ElevenLabs concluída!', { id: 'elevenlabs-transcription' });
      } else if (data?.skipped && data?.reason === 'mixed_track_skipped') {
        toast.warning('Track "mixed" pulado. Use "Agregar Sessão" para transcrição com speakers corretos.', { id: 'elevenlabs-transcription' });
      } else if (data?.skipped && data?.reason === 'already_completed') {
        toast.message('Transcrição já foi concluída anteriormente.', { id: 'elevenlabs-transcription' });
      } else if (data?.skipped) {
        toast.message('Transcrição já está em processamento.', { id: 'elevenlabs-transcription' });
      } else {
        toast.error(data?.message || 'Erro na transcrição ElevenLabs', { id: 'elevenlabs-transcription' });
      }
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    },
    onError: (error) => {
      console.error('ElevenLabs transcription error:', error);
      toast.error('Erro na transcrição ElevenLabs', { id: 'elevenlabs-transcription' });
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    }
  });
}
