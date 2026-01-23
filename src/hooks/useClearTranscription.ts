import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export function useClearTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      // Get existing metadata
      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("metadata")
        .eq("id", recordingId)
        .maybeSingle();

      if (fetchError) {
        throw new Error("Erro ao buscar gravação");
      }

      // Clean all transcription-related metadata
      const existingMetadata = (recording?.metadata as Record<string, unknown> | null) ?? {};
      const cleanedMetadataObj: Record<string, unknown> = {
        ...existingMetadata,
        speaker_segments: null,
        speaker_segments_raw: null,
        speaker_mapping: null,
        readable_transcription: null,
        transcribed_at: null,
        accumulated_words: null,
        aggregation_state: null,
        aggregated_at: null,
        speaker_transcription: null,
      };
      const cleanedMetadata = cleanedMetadataObj as unknown as Json;

      // Clear all transcription fields
      const { error: updateError } = await supabase
        .from("voice_recordings")
        .update({
          transcription: null,
          transcription_status: "pending",
          gemini_chunk_state: null,
          transcription_elevenlabs: null,
          transcription_elevenlabs_status: "pending",
          elevenlabs_chunk_state: null,
          metadata: cleanedMetadata,
        })
        .eq("id", recordingId);

      if (updateError) {
        throw updateError;
      }

      return recordingId;
    },
    onSuccess: () => {
      toast.success("Transcrições limpas!");
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error) => {
      toast.error(`Erro ao limpar: ${error.message}`);
    },
  });
}
