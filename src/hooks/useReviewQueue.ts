import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReviewAction } from "@/lib/reviewTypes";

export interface ReviewRecording {
  id: string;
  filename: string;
  file_url: string | null;
  mp3_file_url: string | null;
  duration_seconds: number | null;
  discord_username: string | null;
  transcription: string | null;
  transcription_elevenlabs: string | null;
  transcription_status: string | null;
  transcription_elevenlabs_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  session_id: string | null;
  language: string | null;
}

export function useReviewQueue() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["review-queue"],
    queryFn: async (): Promise<ReviewRecording[]> => {
      const { data, error } = await supabase
        .from("voice_recordings")
        .select(
          "id, filename, file_url, mp3_file_url, duration_seconds, discord_username, transcription, transcription_elevenlabs, transcription_status, transcription_elevenlabs_status, metadata, created_at, session_id, language"
        )
        .or("transcription_elevenlabs_status.eq.completed,transcription_status.eq.completed")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as ReviewRecording[];
    },
  });

  const submitReview = useMutation({
    mutationFn: async ({
      recordingId,
      action,
      editedTranscription,
    }: {
      recordingId: string;
      action: ReviewAction;
      editedTranscription?: string;
    }) => {
      const updates: Record<string, unknown> = {
        transcription_status: action === "approved" ? "reviewed" : "rejected",
      };

      if (editedTranscription) {
        updates.transcription = editedTranscription;
      }

      const { error } = await supabase
        .from("voice_recordings")
        .update(updates)
        .eq("id", recordingId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    },
  });

  return {
    recordings: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    submitReview,
  };
}
