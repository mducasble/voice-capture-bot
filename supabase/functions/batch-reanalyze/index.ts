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

    const { recording_ids, campaign_id } = await req.json();

    if (!recording_ids && !campaign_id) {
      return new Response(JSON.stringify({ error: 'recording_ids array or campaign_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch recordings - by campaign_id or by explicit IDs
    let query = supabase
      .from('voice_recordings')
      .select('id, file_url, mp3_file_url');
    
    if (campaign_id) {
      query = query.eq('campaign_id', campaign_id);
    } else {
      query = query.in('id', recording_ids);
    }

    const { data: recordings, error } = await query;

    if (error) throw error;

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    console.log(`Batch reanalyze: processing ${recordings?.length} recordings`);

    // Process in batches of 5 with concurrency control using waitUntil
    const BATCH_SIZE = 5;
    const recs = recordings || [];
    let triggered = 0;
    let errors = 0;

    const processAll = async () => {
      for (let i = 0; i < recs.length; i += BATCH_SIZE) {
        const batch = recs.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (rec) => {
            const audioUrl = rec.mp3_file_url || rec.file_url;
            if (!audioUrl) {
              console.warn(`Skipping ${rec.id}: no file URL`);
              return;
            }
            const resp = await fetch(`${baseUrl}/functions/v1/estimate-audio-metrics`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                recording_id: rec.id,
                file_url: audioUrl,
                mode: 'sampled',
              }),
            });
            if (!resp.ok) {
              const text = await resp.text();
              console.error(`Failed ${rec.id}: ${resp.status} ${text.slice(0, 200)}`);
              throw new Error(`${resp.status}`);
            } else {
              await resp.text(); // consume body
              console.log(`OK ${rec.id}`);
            }
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') triggered++;
          else errors++;
        }
        // Small delay between batches to avoid overwhelming
        if (i + BATCH_SIZE < recs.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      console.log(`Batch reanalyze complete: ${triggered} ok, ${errors} errors out of ${recs.length}`);
    };

    // Use EdgeRuntime.waitUntil to keep processing after response
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(processAll());
    } else {
      // Fallback: await directly (will block response but at least work)
      await processAll();
    }

    return new Response(
      JSON.stringify({ success: true, queued: recs.length }),
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
