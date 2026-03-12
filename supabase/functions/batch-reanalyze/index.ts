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

    // Auth check - admin only
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { recording_ids, delay_ms = 5000 } = await req.json();

    if (!recording_ids || !Array.isArray(recording_ids) || recording_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'recording_ids array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch all recordings
    const { data: recordings, error } = await supabase
      .from('voice_recordings')
      .select('id, file_url')
      .in('id', recording_ids);

    if (error) throw error;

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    console.log(`Batch reanalyze: ${recordings?.length} recordings, ${delay_ms}ms delay between each`);

    // Fire-and-forget: trigger each one with a delay to avoid overwhelming the HF Space
    let triggered = 0;
    for (const rec of recordings || []) {
      fetch(`${baseUrl}/functions/v1/estimate-audio-metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          recording_id: rec.id,
          file_url: rec.file_url,
          mode: 'sampled',
        }),
      }).catch(err => console.error(`Failed to trigger ${rec.id}:`, err));

      triggered++;
      
      // Stagger requests
      if (triggered < (recordings?.length || 0)) {
        await new Promise(r => setTimeout(r, delay_ms));
      }
    }

    return new Response(
      JSON.stringify({ success: true, triggered, total: recordings?.length }),
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
