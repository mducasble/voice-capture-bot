import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  file_size_bytes: number | null;
  duration_seconds: number | null;
  sample_rate: number;
  bit_depth: number;
  channels: number;
  format: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function useRecordings(guildId?: string, userId?: string) {
  return useQuery({
    queryKey: ["recordings", guildId, userId],
    queryFn: async (): Promise<Recording[]> => {
      let query = supabase
        .from("voice_recordings")
        .select("*")
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

      return data as Recording[];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

export function useRecordingStats(recordings: Recording[] | undefined) {
  if (!recordings) {
    return {
      totalRecordings: 0,
      totalDuration: "0:00",
      totalSize: "0 MB",
      uniqueServers: 0,
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
  };
}
