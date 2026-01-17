import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useElevenLabsTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      // Get recording details
      const { data: recording, error: fetchError } = await supabase
        .from('voice_recordings')
        .select('mp3_file_url, file_url, language')
        .eq('id', recordingId)
        .single();

      if (fetchError || !recording) {
        throw new Error('Recording not found');
      }

      // Prefer MP3 for smaller file size, fallback to WAV
      const audioUrl = recording.mp3_file_url || recording.file_url;
      if (!audioUrl) {
        throw new Error('No audio file available');
      }

      const { data, error } = await supabase.functions.invoke('transcribe-elevenlabs', {
        body: {
          recording_id: recordingId,
          audio_url: audioUrl,
          language: recording.language
        }
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onMutate: () => {
      toast.loading('Transcrevendo com ElevenLabs...', { id: 'elevenlabs-transcription' });
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
