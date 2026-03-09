import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      filename,
      file_url,
      file_size_bytes,
      original_filename,
      transcription_only,
      campaign_id,
      duration_seconds,
      sample_rate,
      bit_depth,
      channels,
      format: request_format,
    } = await req.json();

    if (!filename || !file_url || !campaign_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: filename, file_url, campaign_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Determine audio format and normalize optional metadata
    const ext = filename.split(".").pop()?.toLowerCase() || "wav";
    const derivedFormat = ext === "mp3" ? "mp3" : ext === "m4a" ? "m4a" : ext === "ogg" ? "ogg" : "wav";
    const normalizedFormat = typeof request_format === "string" && request_format.trim().length > 0
      ? request_format.toLowerCase()
      : derivedFormat;
    const normalizedDuration =
      typeof duration_seconds === "number" && Number.isFinite(duration_seconds) && duration_seconds > 0
        ? duration_seconds
        : null;
    const normalizedSampleRate =
      typeof sample_rate === "number" && Number.isFinite(sample_rate) && sample_rate > 0
        ? sample_rate
        : 48000;
    const normalizedBitDepth =
      typeof bit_depth === "number" && Number.isFinite(bit_depth) && bit_depth > 0
        ? bit_depth
        : 16;
    const normalizedChannels =
      typeof channels === "number" && Number.isFinite(channels) && channels > 0
        ? channels
        : 2;

    // Create recording entry
    const { data: recording, error: insertError } = await supabase
      .from("voice_recordings")
      .insert({
        discord_guild_id: "upload",
        discord_guild_name: "Upload Manual",
        discord_channel_id: "upload",
        discord_channel_name: "Upload",
        discord_user_id: "upload",
        discord_username: "Upload",
        filename,
        file_url,
        file_size_bytes: file_size_bytes || 0,
        duration_seconds: normalizedDuration,
        sample_rate: normalizedSampleRate,
        bit_depth: normalizedBitDepth,
        channels: normalizedChannels,
        format: normalizedFormat,
        status: "completed",
        quality_status: transcription_only ? "transcription-only" : "pending",
        transcription_status: "pending",
        transcription_elevenlabs_status: "pending",
        metadata: {
          source: transcription_only ? "transcription_only_upload" : "manual_upload",
          original_filename,
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error(`Failed to create recording: ${insertError.message}`);
    }

    console.log(`Created recording ${recording.id} from upload: ${original_filename}`);

    const recordingId = recording.id;

    // Start processing (will trigger both Gemini and ElevenLabs after chunks are created)
    const processPromise = supabase.functions.invoke("process-audio", {
      body: {
        recording_id: recordingId,
        audio_url: file_url,
      },
    });

    // Use EdgeRuntime.waitUntil if available, otherwise fire and forget
    // @ts-ignore EdgeRuntime available
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        processPromise
          .then(({ error }: { error?: unknown }) => {
            if (error) console.error("Process-audio error:", error);
            else console.log(`Processing started for ${recordingId}`);
          })
          .catch((err: unknown) => console.error("Process-audio trigger error:", err))
      );
    } else {
      processPromise
        .then(({ error }: { error?: unknown }) => {
          if (error) console.error("Process-audio error:", error);
        })
        .catch((err: unknown) => console.error("Process-audio trigger failed:", err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        recording_id: recordingId,
        message: "Recording created, transcriptions started",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
