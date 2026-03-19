import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useEnhanceAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { recordingId: string; fileUrl: string }) => {
      // 1. Create a queue entry for tracking (needed for multi-segment enhance)
      const { data: queueEntry, error: queueError } = await supabase
        .from('analysis_queue')
        .insert({
          recording_id: params.recordingId,
          status: 'processing',
          priority: 5,
          job_type: 'enhance',
          started_at: new Date().toISOString(),
        } as any)
        .select('id')
        .single();

      if (queueError) throw new Error(queueError.message);

      // 2. Call enhance-audio directly instead of waiting for cron
      const { data, error } = await supabase.functions.invoke("enhance-audio", {
        body: {
          recording_id: params.recordingId,
          file_url: params.fileUrl,
          job_id: queueEntry.id,
        },
      });

      if (error) {
        // Mark queue entry as failed
        await supabase
          .from('analysis_queue')
          .update({
            status: 'failed',
            last_error: error.message,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', queueEntry.id);
        throw error;
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      toast.success("Enhancement iniciado!", {
        description: "O áudio está sendo processado. Acompanhe o status na fila.",
      });
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
      queryClient.invalidateQueries({ queryKey: ["enhance-job", variables.recordingId] });
    },
    onError: (error: Error) => {
      toast.error("Erro ao iniciar enhancement", {
        description: error.message,
      });
    },
  });
}
