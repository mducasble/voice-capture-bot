import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export function useReprocessRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      // First get the recording to get the file_url
      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("file_url, metadata")
        .eq("id", recordingId)
        .single();

      if (fetchError || !recording?.file_url) {
        throw new Error("Recording not found or missing file URL");
      }

      // Clean transcription-related metadata so the UI doesn't keep showing old speaker/transcription data
      const existingMetadata = (recording.metadata as Record<string, unknown> | null) ?? {};
      const cleanedMetadataObj: Record<string, unknown> = {
        ...existingMetadata,
        // ElevenLabs diarization exports
        speaker_segments: null,
        speaker_segments_raw: null,
        speaker_mapping: null,
        readable_transcription: null,
        transcribed_at: null,
        // Session aggregation exports
        aggregation_state: null,
        aggregated_at: null,
        // Any other derived text we might have stored
        speaker_transcription: null,
      };
      const cleanedMetadata = cleanedMetadataObj as unknown as Json;

      // Reset status to processing
      const { error: updateError } = await supabase
        .from("voice_recordings")
        .update({
          status: "processing",
          transcription_status: "pending",
          transcription: null,
          gemini_chunk_state: null,
          quality_status: null,
          snr_db: null,
          // Reset ElevenLabs transcription as well, so re-transcribing doesn't append old failures
          transcription_elevenlabs: null,
          transcription_elevenlabs_status: null,
          elevenlabs_chunk_state: null,
          metadata: cleanedMetadata,
          // Keep mp3_file_url (compressed version) so we can run "full file" transcription reliably.
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
