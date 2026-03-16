import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useEnhanceAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { recordingId: string; fileUrl: string }) => {
      // Enqueue an enhance job in analysis_queue instead of calling the edge function directly
      const { data, error } = await supabase
        .from('analysis_queue')
        .insert({
          recording_id: params.recordingId,
          status: 'pending',
          priority: 5, // higher priority than normal analysis (default 0)
          job_type: 'enhance',
        } as any)
        .select('id')
        .single();

      if (error) throw new Error(error.message);
      return { queued: true, job_id: data.id };
    },
    onSuccess: () => {
      toast.success("Enhancement enfileirado!", {
        description: "O áudio será processado em background. Acompanhe o status na fila.",
      });
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error: Error) => {
      toast.error("Erro ao enfileirar enhancement", {
        description: error.message,
      });
    },
  });
}
