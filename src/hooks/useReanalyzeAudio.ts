import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useReanalyzeAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      // Get the recording's file URL
      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("file_url, mp3_file_url")
        .eq("id", recordingId)
        .single();

      if (fetchError || !recording) {
        throw new Error("Gravação não encontrada");
      }

      const audioUrl = recording.mp3_file_url || recording.file_url;
      if (!audioUrl) {
        throw new Error("URL do áudio não encontrada");
      }

      // Call estimate-audio-metrics edge function
      const { data, error } = await supabase.functions.invoke("estimate-audio-metrics", {
        body: {
          recording_id: recordingId,
          file_url: audioUrl,
        },
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      toast.success("Análise de métricas reenviada com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error) => {
      toast.error(`Erro ao reenviar análise: ${error.message}`);
    },
  });
}
