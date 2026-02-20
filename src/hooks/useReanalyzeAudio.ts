import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AnalysisMode = "sampled" | "full_segments";

export function useReanalyzeAudio(mode: AnalysisMode = "sampled") {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("file_url, mp3_file_url, metadata")
        .eq("id", recordingId)
        .single();

      if (fetchError || !recording) {
        throw new Error("Gravação não encontrada");
      }

      // Prioriza arquivo melhorado se existir
      const meta = recording.metadata as Record<string, unknown> | null;
      const enhancedUrl = meta?.enhanced_file_url as string | undefined;
      const audioUrl = enhancedUrl || recording.mp3_file_url || recording.file_url;
      if (!audioUrl) {
        throw new Error("URL do áudio não encontrada");
      }

      const { data, error } = await supabase.functions.invoke("estimate-audio-metrics", {
        body: {
          recording_id: recordingId,
          file_url: audioUrl,
          mode,
        },
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      const label = mode === "full_segments" 
        ? "Análise completa (segmentos de 1min)" 
        : "Análise amostrada (10s/min)";
      toast.success(`${label} reenviada com sucesso!`);
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error) => {
      toast.error(`Erro ao reenviar análise: ${error.message}`);
    },
  });
}
