import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Hook to transcribe only the first ~4 minutes (8 chunks of 30s each)
 * for testing/validation purposes without consuming too many credits.
 */
export function useElevenLabsTestTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recordingId }: { recordingId: string }) => {
      const { data, error } = await supabase.functions.invoke('transcribe-elevenlabs', {
        body: {
          recording_id: recordingId,
          mode: 'chunks',
          max_chunks: 8, // 8 chunks * 30s = 4 minutes
          force: true,   // Force re-process even if completed
        }
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onMutate: () => {
      toast.loading('Transcrevendo primeiros 4 minutos (teste)...', { id: 'elevenlabs-test' });
    },
    onSuccess: (data: any) => {
      if (data?.success && data?.scheduled_processing) {
        toast.message('Processamento iniciado — teste vai começar em seguida.', { id: 'elevenlabs-test' });
      } else if (data?.success && !data?.skipped) {
        toast.success('Teste de transcrição concluído!', { id: 'elevenlabs-test' });
      } else if (data?.skipped) {
        toast.message('Transcrição já está em processamento.', { id: 'elevenlabs-test' });
      } else {
        toast.error(data?.message || 'Erro no teste de transcrição', { id: 'elevenlabs-test' });
      }
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    },
    onError: (error) => {
      console.error('ElevenLabs test transcription error:', error);
      toast.error('Erro no teste de transcrição', { id: 'elevenlabs-test' });
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    }
  });
}
