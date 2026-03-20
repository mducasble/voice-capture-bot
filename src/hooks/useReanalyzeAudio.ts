import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AnalysisMode = "sampled" | "full_segments";
type AnalysisTarget = "original" | "enhanced";

export function useReanalyzeAudio(mode: AnalysisMode = "sampled", target: AnalysisTarget = "original") {
  const queryClient = useQueryClient();
  const toastIdRef = useRef<string | number | undefined>();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      const targetLabel = target === "enhanced" ? " (Enhanced)" : "";
      const modeLabel = mode === "full_segments"
        ? "Análise completa"
        : "Análise amostrada";
      toastIdRef.current = toast.loading(`${modeLabel}${targetLabel} em andamento…`, {
        description: "Aguarde enquanto o processamento é realizado.",
      });

      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("file_url, mp3_file_url, metadata")
        .eq("id", recordingId)
        .single();

      if (fetchError || !recording) {
        throw new Error("Gravação não encontrada");
      }

      let audioUrl: string | null;

      if (target === "enhanced") {
        const meta = recording.metadata as Record<string, unknown> | null;
        const enhancedUrl = meta?.enhanced_file_url as string | undefined;
        if (!enhancedUrl) {
          throw new Error("Arquivo melhorado não encontrado. Execute o enhancement primeiro.");
        }
        audioUrl = enhancedUrl;
      } else {
        audioUrl = recording.mp3_file_url || recording.file_url;
      }

      if (!audioUrl) {
        throw new Error("URL do áudio não encontrada");
      }

      const { data, error } = await supabase.functions.invoke("estimate-audio-metrics", {
        body: {
          recording_id: recordingId,
          file_url: audioUrl,
          mode,
          target,
        },
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: (data) => {
      const targetLabel = target === "enhanced" ? " (Enhanced)" : "";
      const modeLabel = mode === "full_segments"
        ? "Análise completa (segmentos de 1min)"
        : "Análise amostrada (10s/min)";
      const service = data?.service || "";
      toast.success(`${modeLabel}${targetLabel} concluída!`, {
        id: toastIdRef.current,
        description: service ? `Serviço: ${service}` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error) => {
      toast.error(`Erro ao reenviar análise: ${error.message}`, {
        id: toastIdRef.current,
      });
    },
  });
}
