import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id, file_url, snr_db, rms_dbfs } = await req.json();

    if (!recording_id || !file_url) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id or file_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const METRICS_API_URL = Deno.env.get('METRICS_API_URL');
    const METRICS_API_SECRET = Deno.env.get('METRICS_API_SECRET');
    if (!METRICS_API_URL) {
      return new Response(
        JSON.stringify({ error: 'METRICS_API_URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Download audio file
    console.log(`Downloading audio for recording ${recording_id}`);
    const audioResp = await fetch(file_url);
    if (!audioResp.ok) {
      throw new Error(`Failed to download audio: ${audioResp.status}`);
    }

    const audioBlob = await audioResp.blob();
    const isMP3 = file_url.toLowerCase().includes('.mp3');
    const filename = isMP3 ? 'audio.mp3' : 'audio.wav';

    // Send to external metrics API
    console.log(`Sending audio to metrics API for recording ${recording_id}`);
    const formData = new FormData();
    formData.append('file', audioBlob, filename);

    const headers: Record<string, string> = {};
    if (METRICS_API_SECRET) {
      headers['Authorization'] = `Bearer ${METRICS_API_SECRET}`;
    }

    const apiResponse = await fetch(`${METRICS_API_URL}/analyze`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('Metrics API error:', apiResponse.status, errText);
      throw new Error(`Metrics API error: ${apiResponse.status}`);
    }

    const metrics = await apiResponse.json();
    console.log(`Metrics received for recording ${recording_id}:`, JSON.stringify(metrics));

    // Update recording metadata
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: recording } = await supabase
      .from('voice_recordings')
      .select('metadata')
      .eq('id', recording_id)
      .single();

    const metadata = {
      ...(recording?.metadata || {}),
      srmr: metrics.srmr ?? null,
      sigmos_disc: metrics.sigmos_disc ?? null,
      sigmos_ovrl: metrics.sigmos_ovrl ?? null,
      sigmos_reverb: metrics.sigmos_reverb ?? null,
      vqscore: metrics.vqscore ?? null,
      wvmos: metrics.wvmos ?? null,
      utmos: metrics.utmos ?? null,
      mic_sr: metrics.mic_sr ?? null,
      file_sr: metrics.file_sr ?? null,
      metrics_source: 'huggingface-space',
      metrics_estimated_at: new Date().toISOString(),
    };

    await supabase
      .from('voice_recordings')
      .update({ metadata })
      .eq('id', recording_id);

    console.log(`Metrics saved for recording ${recording_id}`);

    return new Response(
      JSON.stringify({ success: true, recording_id, metrics }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Metrics estimation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
