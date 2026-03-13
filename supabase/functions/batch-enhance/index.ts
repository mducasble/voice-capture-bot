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

    const { recording_ids } = await req.json();

    if (!recording_ids || !Array.isArray(recording_ids) || recording_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'recording_ids array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch all recordings with their file URLs
    const { data: recordings, error } = await supabase
      .from('voice_recordings')
      .select('id, file_url')
      .in('id', recording_ids);

    if (error) throw error;

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    console.log(`Batch enhance: firing ${recordings?.length} requests`);

    // Fire ALL requests immediately (fire-and-forget)
    for (const rec of recordings || []) {
      fetch(`${baseUrl}/functions/v1/enhance-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          recording_id: rec.id,
          file_url: rec.file_url,
        }),
      }).catch(err => console.error(`Failed to trigger enhance for ${rec.id}:`, err));
    }

    return new Response(
      JSON.stringify({ success: true, triggered: recordings?.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Batch enhance error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
