import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useDeleteRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      // First get the recording to find the file paths
      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("filename, mp3_file_url")
        .eq("id", recordingId)
        .maybeSingle();

      if (fetchError) {
        throw new Error(`Failed to fetch recording: ${fetchError.message}`);
      }

      if (!recording) {
        throw new Error("Recording not found");
      }

      // Delete files from storage
      const filesToDelete: string[] = [];
      
      if (recording.filename) {
        filesToDelete.push(recording.filename);
      }

      // Extract compressed filename from mp3_file_url if it exists
      if (recording.mp3_file_url) {
        // Extract path from full URL
        const urlParts = recording.mp3_file_url.split('/voice-recordings/');
        if (urlParts.length > 1) {
          filesToDelete.push(urlParts[1]);
        }
      }

      if (filesToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from("voice-recordings")
          .remove(filesToDelete);

        if (storageError) {
          console.error("Storage delete error:", storageError);
          // Continue with database deletion even if storage fails
        }
      }

      // Delete from database
      const { error: deleteError } = await supabase
        .from("voice_recordings")
        .delete()
        .eq("id", recordingId);

      if (deleteError) {
        throw new Error(`Failed to delete recording: ${deleteError.message}`);
      }

      return recordingId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
      toast.success("Gravação deletada com sucesso");
    },
    onError: (error) => {
      toast.error(`Erro ao deletar: ${error.message}`);
    },
  });
}
