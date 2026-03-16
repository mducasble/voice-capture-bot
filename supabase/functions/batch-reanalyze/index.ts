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

    const { recording_ids, campaign_id, offset = 0, batch_size = 3, _internal_stats } = await req.json();

    if (!recording_ids && !campaign_id) {
      return new Response(JSON.stringify({ error: 'recording_ids array or campaign_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch recordings for this batch only
    let query = supabase
      .from('voice_recordings')
      .select('id, file_url, mp3_file_url')
      .order('created_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (campaign_id) {
      query = query.eq('campaign_id', campaign_id);
    } else {
      query = query.in('id', recording_ids);
    }

    const { data: recordings, error } = await query;
    if (error) throw error;

    const recs = recordings || [];
    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // Track stats across chain
    const stats = _internal_stats || { triggered: 0, errors: 0, skipped: 0, total_offset: 0 };

    console.log(`Batch reanalyze: offset=${offset}, got ${recs.length} recordings`);

    // Process this batch sequentially (each takes ~15-30s)
    for (const rec of recs) {
      const audioUrl = rec.mp3_file_url || rec.file_url;
      if (!audioUrl) {
        console.warn(`Skipping ${rec.id}: no file URL`);
        stats.skipped++;
        continue;
      }

      try {
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

        const body = await resp.text();
        if (!resp.ok) {
          console.error(`Failed ${rec.id}: ${resp.status} ${body.slice(0, 200)}`);
          stats.errors++;
        } else {
          console.log(`OK ${rec.id}`);
          stats.triggered++;
        }
      } catch (e) {
        console.error(`Error ${rec.id}: ${e.message}`);
        stats.errors++;
      }
    }

    stats.total_offset = offset + recs.length;

    // If we got a full batch, there are probably more — chain to next batch
    if (recs.length === batch_size) {
      const nextOffset = offset + batch_size;
      console.log(`Chaining next batch at offset ${nextOffset}. Stats so far: ${JSON.stringify(stats)}`);

      // Fire-and-forget the next batch call
      const chainBody: Record<string, unknown> = {
        offset: nextOffset,
        batch_size,
        _internal_stats: stats,
      };
      if (campaign_id) chainBody.campaign_id = campaign_id;
      if (recording_ids) chainBody.recording_ids = recording_ids;

      // Use waitUntil so the chain request survives after we return
      const chainPromise = fetch(`${baseUrl}/functions/v1/batch-reanalyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(chainBody),
      }).then(r => r.text()).catch(e => console.error('Chain error:', e.message));

      // @ts-ignore
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(chainPromise);
      } else {
        await chainPromise;
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          status: 'processing',
          processed_this_batch: recs.length,
          next_offset: nextOffset,
          stats 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No more recordings — we're done
    console.log(`Batch reanalyze COMPLETE. Final stats: ${JSON.stringify(stats)}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        status: 'complete',
        stats 
      }),
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
