import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FormattedSegment {
  start: string;
  end: string;
  speaker: string;
  text: string;
}

/**
 * Hook to regenerate the transcription JSON from existing speaker_segments
 * without re-transcribing the audio (saves ElevenLabs credits)
 */
export function useRegenerateJson() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      // Fetch the recording with metadata
      const { data: recording, error: fetchError } = await supabase
        .from("voice_recordings")
        .select("id, metadata, transcription_elevenlabs_status")
        .eq("id", recordingId)
        .single();

      if (fetchError || !recording) {
        throw new Error("Recording not found");
      }

      const metadata = recording.metadata as {
        speaker_segments?: FormattedSegment[];
        speaker_mapping?: Record<string, string>;
      } | null;

      if (!metadata?.speaker_segments || !Array.isArray(metadata.speaker_segments)) {
        throw new Error("No speaker segments found in metadata. Run ElevenLabs transcription first.");
      }

      // Regenerate JSON with correct property order: start, end, speaker, text
      const orderedSegments = metadata.speaker_segments.map(seg => ({
        start: seg.start,
        end: seg.end,
        speaker: seg.speaker,
        text: seg.text,
      }));

      const jsonTranscription = JSON.stringify(orderedSegments);

      // Update the transcription_elevenlabs field
      const { error: updateError } = await supabase
        .from("voice_recordings")
        .update({
          transcription_elevenlabs: jsonTranscription,
        })
        .eq("id", recordingId);

      if (updateError) {
        throw new Error(`Failed to update recording: ${updateError.message}`);
      }

      return { 
        success: true, 
        segmentCount: orderedSegments.length 
      };
    },
    onSuccess: (data) => {
      toast.success(`JSON regenerado com ${data.segmentCount} segmentos`);
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao regenerar JSON: ${error.message}`);
    },
  });
}
