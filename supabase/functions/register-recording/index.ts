import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-api-key',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate bot API key
    const botApiKey = req.headers.get('x-bot-api-key');
    const expectedApiKey = Deno.env.get('BOT_API_KEY');
    
    if (!botApiKey || botApiKey !== expectedApiKey) {
      console.error('Invalid or missing bot API key');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // This endpoint receives metadata only - file is already uploaded to Storage
    const body = await req.json();
    const {
      filename,
      file_url,
      file_size_bytes,
      discord_guild_id,
      discord_guild_name,
      discord_channel_id,
      discord_channel_name,
      discord_user_id,
      discord_username,
      duration_seconds,
      topic_id,
      language,
      campaign_id,
      session_id,
      recording_type,
      extra
    } = body;

    if (!filename || !file_url || !campaign_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: filename, file_url, campaign_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Registering recording:', {
      filename,
      guildId: discord_guild_id,
      userId: discord_user_id,
      fileSize: file_size_bytes
    });

    // Insert record into database
    // SNR analysis is skipped for large files - can be done async later if needed
    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id,
        discord_guild_name,
        discord_channel_id,
        discord_channel_name,
        discord_user_id,
        discord_username,
        filename,
        file_url,
        file_size_bytes,
        duration_seconds,
        sample_rate: 48000,
        bit_depth: 16,
        channels: 2,
        format: 'wav',
        status: 'completed',
        snr_db: null,
        quality_status: 'skipped',
        topic_id: topic_id || null,
        language: language || 'en',
        campaign_id,
        session_id: session_id || null,
        recording_type: recording_type || 'mixed',
        metadata: extra || {},
        transcription_status: 'pending'
      })
      .select()
      .single();

    if (recordError) {
      console.error('Database insert error:', recordError);
      return new Response(
        JSON.stringify({ error: 'Failed to save recording metadata', details: recordError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Recording registered successfully:', { id: recordData.id });

    // Trigger audio processing (compression + SNR + transcription) asynchronously
    const processUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-audio`;
    
    fetch(processUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        recording_id: recordData.id,
        audio_url: file_url
      })
    }).then(res => {
      console.log(`Audio processing triggered for ${recordData.id}, status: ${res.status}`);
    }).catch(err => {
      console.error(`Failed to trigger audio processing for ${recordData.id}:`, err);
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        recording: recordData,
        transcription: {
          status: 'pending',
          message: 'Transcription started in background'
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
