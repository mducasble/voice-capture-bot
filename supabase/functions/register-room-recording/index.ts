import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const {
      filename,
      file_url,
      file_size_bytes,
      session_id,
      participant_id,
      participant_name,
      recording_type = 'individual',
      format = 'wav',
      language = 'pt',
    } = await req.json();

    if (!filename || !file_url || !session_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: filename, file_url, session_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Registering room recording: ${filename} for ${participant_name}`);

    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id: 'webapp',
        discord_channel_id: session_id,
        discord_user_id: participant_id,
        discord_username: participant_name,
        filename,
        file_url,
        file_size_bytes: file_size_bytes || 0,
        sample_rate: 48000,
        bit_depth: 16,
        channels: 1,
        format,
        status: 'completed',
        session_id,
        recording_type,
        transcription_status: 'pending',
        language,
        metadata: { source: 'webapp', participant_id },
      })
      .select()
      .single();

    if (recordError) {
      console.error('Database insert error:', recordError);
      return new Response(
        JSON.stringify({ error: 'Failed to save recording', details: recordError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Recording registered: ${recordData.id}`);

    // Trigger processing asynchronously
    const processUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-audio`;
    fetch(processUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        recording_id: recordData.id,
        audio_url: file_url,
      }),
    }).catch(err => console.error('Failed to trigger processing:', err));

    return new Response(
      JSON.stringify({ success: true, recording_id: recordData.id, file_url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
