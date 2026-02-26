import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bot-api-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate bot API key
    const botApiKey = req.headers.get("x-bot-api-key");
    const expectedApiKey = Deno.env.get("BOT_API_KEY");

    if (!botApiKey || botApiKey !== expectedApiKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const {
      campaign_id,
      section_id,
      filename,
      file_url,
      file_size_bytes,
      duration_seconds,
      sample_rate,
      bit_depth,
      channels,
      format,
      language,
      speaker_id,
      speaker_name,
      session_id,
      recording_type,
      extra,
    } = body;

    // Validate required fields
    if (!campaign_id || !filename || !file_url) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: campaign_id, filename, file_url",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify campaign exists and is active
    const { data: campaign, error: campError } = await supabase
      .from("campaigns")
      .select("id, name, is_active, audio_sample_rate, audio_bit_depth, audio_channels, audio_format, audio_min_duration_seconds, audio_max_duration_seconds, audio_min_snr_db")
      .eq("id", campaign_id)
      .single();

    if (campError || !campaign) {
      return new Response(
        JSON.stringify({ error: "Campaign not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!campaign.is_active) {
      return new Response(
        JSON.stringify({ error: "Campaign is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate section if provided
    if (section_id) {
      const { data: section, error: secError } = await supabase
        .from("campaign_sections")
        .select("id")
        .eq("id", section_id)
        .eq("campaign_id", campaign_id)
        .single();

      if (secError || !section) {
        return new Response(
          JSON.stringify({ error: "Section not found in this campaign" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Validate audio specs against campaign requirements
    const warnings: string[] = [];
    if (campaign.audio_min_duration_seconds && duration_seconds && duration_seconds < campaign.audio_min_duration_seconds) {
      warnings.push(`Duration ${duration_seconds}s is below minimum ${campaign.audio_min_duration_seconds}s`);
    }
    if (campaign.audio_max_duration_seconds && duration_seconds && duration_seconds > campaign.audio_max_duration_seconds) {
      warnings.push(`Duration ${duration_seconds}s exceeds maximum ${campaign.audio_max_duration_seconds}s`);
    }

    console.log("Registering campaign audio:", {
      campaign_id,
      section_id,
      filename,
      speaker_id,
    });

    // Insert recording
    const { data: recording, error: insertError } = await supabase
      .from("voice_recordings")
      .insert({
        campaign_id,
        section_id: section_id || null,
        session_id: session_id || null,
        filename,
        file_url,
        file_size_bytes: file_size_bytes || 0,
        duration_seconds: duration_seconds || null,
        sample_rate: sample_rate || campaign.audio_sample_rate || 48000,
        bit_depth: bit_depth || campaign.audio_bit_depth || 16,
        channels: channels || campaign.audio_channels || 1,
        format: format || campaign.audio_format || "wav",
        language: language || "pt",
        recording_type: recording_type || "single",
        discord_guild_id: "electron-app",
        discord_guild_name: "Electron App",
        discord_channel_id: campaign_id,
        discord_channel_name: campaign.name,
        discord_user_id: speaker_id || "unknown",
        discord_username: speaker_name || "Unknown",
        status: "completed",
        quality_status: "pending",
        transcription_status: "pending",
        transcription_elevenlabs_status: "pending",
        metadata: {
          source: "electron_app",
          speaker_id,
          speaker_name,
          ...(extra || {}),
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error(`Failed to save recording: ${insertError.message}`);
    }

    console.log("Campaign audio registered:", recording.id);

    // Trigger async processing
    const processUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-audio`;
    fetch(processUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        recording_id: recording.id,
        audio_url: file_url,
      }),
    })
      .then((res) =>
        console.log(`Processing triggered for ${recording.id}: ${res.status}`)
      )
      .catch((err) =>
        console.error(`Failed to trigger processing for ${recording.id}:`, err)
      );

    return new Response(
      JSON.stringify({
        success: true,
        recording_id: recording.id,
        campaign_id,
        section_id: section_id || null,
        warnings,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
