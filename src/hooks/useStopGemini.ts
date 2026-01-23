import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useStopGemini() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      const { error } = await supabase
        .from("voice_recordings")
        .update({
          gemini_chunk_state: null,
          transcription_status: "pending",
        })
        .eq("id", recordingId);

      if (error) {
        throw error;
      }

      return recordingId;
    },
    onSuccess: () => {
      toast.success("Gemini interrompido!");
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error) => {
      toast.error(`Erro ao parar Gemini: ${error.message}`);
    },
  });
}
