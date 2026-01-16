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

    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const metadata = JSON.parse(formData.get('metadata') as string || '{}');

    if (!audioFile) {
      return new Response(
        JSON.stringify({ error: 'No audio file provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Received upload request:', {
      filename: metadata.filename,
      guildId: metadata.discord_guild_id,
      userId: metadata.discord_user_id,
      fileSize: audioFile.size
    });

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueFilename = `${metadata.discord_guild_id}/${metadata.discord_user_id}/${timestamp}_${metadata.filename || 'recording.wav'}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('voice-recordings')
      .upload(uniqueFilename, audioFile, {
        contentType: 'audio/wav',
        upsert: false
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload file', details: uploadError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('voice-recordings')
      .getPublicUrl(uniqueFilename);

    // Insert record into database
    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id: metadata.discord_guild_id,
        discord_guild_name: metadata.discord_guild_name,
        discord_channel_id: metadata.discord_channel_id,
        discord_channel_name: metadata.discord_channel_name,
        discord_user_id: metadata.discord_user_id,
        discord_username: metadata.discord_username,
        filename: uniqueFilename,
        file_url: publicUrl,
        file_size_bytes: audioFile.size,
        duration_seconds: metadata.duration_seconds,
        sample_rate: 44100,
        bit_depth: 16,
        channels: 2,
        format: 'wav',
        status: 'completed',
        metadata: metadata.extra || {}
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

    console.log('Recording uploaded successfully:', recordData.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        recording: recordData,
        file_url: publicUrl 
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
