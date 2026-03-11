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

    // Extract user_id from JWT if present
    let authUserId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) authUserId = user.id;
    }

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
      campaign_id,
      audio_profile,
    } = await req.json();

    if (!filename || !file_url || !session_id || !campaign_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: filename, file_url, session_id, campaign_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Registering room recording: ${filename} for ${participant_name} (${file_size_bytes} bytes)`);

    // Check for duplicate: individual recording for this participant+session
    if (recording_type === 'individual') {
      const { data: existing } = await supabase
        .from('voice_recordings')
        .select('id')
        .eq('discord_channel_id', session_id)
        .eq('discord_user_id', participant_id)
        .eq('recording_type', 'individual')
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`Duplicate found for ${participant_id} in session ${session_id}, skipping`);
        return new Response(
          JSON.stringify({ success: true, recording_id: existing[0].id, file_url, skipped_duplicate: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Calculate duration from WAV file size (PCM 16-bit mono 48kHz + 44 byte header)
    const sampleRate = 48000;
    const headerSize = 44;
    const pcmBytes = Math.max(0, (file_size_bytes || 0) - headerSize);
    const durationSeconds = pcmBytes / (sampleRate * 1 * 2); // mono, 16-bit

    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id: 'webapp',
        discord_channel_id: session_id,
        discord_user_id: participant_id,
        discord_username: participant_name,
        user_id: authUserId,
        campaign_id,
        filename,
        file_url,
        file_size_bytes: file_size_bytes || 0,
        duration_seconds: durationSeconds > 0 ? durationSeconds : null,
        sample_rate: sampleRate,
        bit_depth: 16,
        channels: 1,
        format,
        status: format === 'wav' ? 'processing' : 'completed',
        session_id,
        recording_type,
        transcription_status: 'pending',
        language,
        metadata: { source: 'webapp', participant_id, campaign_id },
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
