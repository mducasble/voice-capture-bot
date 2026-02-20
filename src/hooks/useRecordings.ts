import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ElevenLabsChunkState {
  chunkNames: string[];
  nextIndex: number;
  lockedAt: string;
}

interface GeminiChunkState {
  chunkUrls: { url: string; index: number }[];
  nextIndex: number;
  transcriptions: string[];
  chunkSegments?: { start: string; end: string; speaker: string; text: string }[][];
  detectedLanguage: string | null;
  lockedAt: string | null;
}

interface Recording {
  id: string;
  discord_guild_id: string;
  discord_guild_name: string | null;
  discord_channel_id: string;
  discord_channel_name: string | null;
  discord_user_id: string;
  discord_username: string | null;
  filename: string;
  file_url: string | null;
  mp3_file_url: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  sample_rate: number;
  bit_depth: number;
  channels: number;
  format: string;
  status: string;
  snr_db: number | null;
  quality_status: string | null;
  transcription: string | null;
  transcription_status: string | null;
  transcription_elevenlabs: string | null;
  transcription_elevenlabs_status: string | null;
  elevenlabs_chunk_state: ElevenLabsChunkState | null;
  gemini_chunk_state: GeminiChunkState | null;
  language: string | null;
  session_id: string | null;
  recording_type: 'individual' | 'mixed' | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type { Recording, GeminiChunkState, ElevenLabsChunkState };

export function useRecordings(guildId?: string, userId?: string) {
  return useQuery({
    queryKey: ["recordings", guildId, userId],
    queryFn: async (): Promise<Recording[]> => {
      let query = supabase
        .from("voice_recordings")
        .select("*, elevenlabs_chunk_state, gemini_chunk_state")
        .neq("quality_status", "transcription-only")
        .order("created_at", { ascending: false });

      if (guildId) {
        query = query.eq("discord_guild_id", guildId);
      }

      if (userId) {
        query = query.eq("discord_user_id", userId);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      // Cast the data, handling the chunk state JSON fields
      return (data || []).map((row: any) => ({
        ...row,
        elevenlabs_chunk_state: row.elevenlabs_chunk_state as ElevenLabsChunkState | null,
        gemini_chunk_state: row.gemini_chunk_state as GeminiChunkState | null,
      })) as Recording[];
    },
    refetchInterval: (query) => {
      // Refetch every 5 seconds if any recording is processing
      const data = query.state.data;
      const hasProcessing = data?.some(
        (r: Recording) => r.status === "processing" || r.transcription_status === "processing" || r.transcription_elevenlabs_status === "processing"
      );
      return hasProcessing ? 5000 : 30000;
    },
  });
}

export function useRecordingStats(recordings: Recording[] | undefined) {
  if (!recordings) {
    return {
      totalRecordings: 0,
      totalDuration: "0:00",
      totalSize: "0 MB",
      uniqueServers: 0,
      storageStats: {
        totalBytes: 0,
        compressedBytes: 0,
        recordingCount: 0,
      },
    };
  }

  const totalDurationSeconds = recordings.reduce(
    (sum, r) => sum + (r.duration_seconds || 0),
    0
  );

  const totalBytes = recordings.reduce(
    (sum, r) => sum + (r.file_size_bytes || 0),
    0
  );

  // Estimate compressed size (typically 10-15x smaller for 16kHz mono vs 48kHz stereo)
  // Based on actual compression in upload-recording: 48kHz stereo -> 16kHz mono
  const compressionRatio = 6; // Conservative estimate
  const compressedBytes = recordings.reduce((sum, r) => {
    const originalSize = r.file_size_bytes || 0;
    return sum + Math.round(originalSize / compressionRatio);
  }, 0);

  const uniqueServers = new Set(recordings.map((r) => r.discord_guild_id)).size;

  const hours = Math.floor(totalDurationSeconds / 3600);
  const minutes = Math.floor((totalDurationSeconds % 3600) / 60);
  const formattedDuration = hours > 0 
    ? `${hours}h ${minutes}m` 
    : `${minutes}m`;

  const formattedSize = totalBytes > 1024 * 1024 * 1024
    ? `${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    : `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;

  return {
    totalRecordings: recordings.length,
    totalDuration: formattedDuration,
    totalSize: formattedSize,
    uniqueServers,
    storageStats: {
      totalBytes,
      compressedBytes,
      recordingCount: recordings.length,
    },
  };
}
