import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useReprocessRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      // First get the recording to get the file_url
      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("file_url")
        .eq("id", recordingId)
        .single();

      if (fetchError || !recording?.file_url) {
        throw new Error("Recording not found or missing file URL");
      }

      // Reset status to processing
      const { error: updateError } = await supabase
        .from("voice_recordings")
        .update({
          status: "processing",
          transcription_status: "pending",
          quality_status: null,
          snr_db: null,
          mp3_file_url: null,
        })
        .eq("id", recordingId);

      if (updateError) {
        throw updateError;
      }

      // Call process-audio edge function
      const { error } = await supabase.functions.invoke("process-audio", {
        body: {
          recording_id: recordingId,
          audio_url: recording.file_url,
        },
      });

      if (error) {
        throw error;
      }

      return recordingId;
    },
    onSuccess: () => {
      toast.success("Reprocessamento iniciado!");
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error) => {
      toast.error(`Erro ao reprocessar: ${error.message}`);
    },
  });
}
