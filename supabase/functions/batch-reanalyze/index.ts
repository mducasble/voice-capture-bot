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

    const { recording_ids, campaign_id, offset = 0, batch_size = 2, _internal_stats } = await req.json();

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

    const stats = _internal_stats || { triggered: 0, errors: 0, skipped: 0 };

    console.log(`Batch reanalyze: offset=${offset}, got ${recs.length} recordings (stats: t=${stats.triggered} e=${stats.errors} s=${stats.skipped})`);

    if (recs.length === 0) {
      console.log(`Batch reanalyze COMPLETE. Final stats: ${JSON.stringify(stats)}`);
      return new Response(
        JSON.stringify({ success: true, status: 'complete', stats }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process this batch + chain in background, respond immediately
    const processAndChain = async () => {
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
            console.error(`FAIL ${rec.id}: ${resp.status} ${body.slice(0, 200)}`);
            stats.errors++;
          } else {
            console.log(`OK ${rec.id} (total: ${stats.triggered + 1})`);
            stats.triggered++;
          }
        } catch (e) {
          console.error(`ERR ${rec.id}: ${e.message}`);
          stats.errors++;
        }
      }

      // Chain to next batch if we got a full batch
      if (recs.length === batch_size) {
        const nextOffset = offset + batch_size;
        console.log(`Chaining to offset ${nextOffset}...`);

        const chainBody: Record<string, unknown> = {
          offset: nextOffset,
          batch_size,
          _internal_stats: stats,
        };
        if (campaign_id) chainBody.campaign_id = campaign_id;
        if (recording_ids) chainBody.recording_ids = recording_ids;

        try {
          const chainResp = await fetch(`${baseUrl}/functions/v1/batch-reanalyze`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceKey}`,
            },
            body: JSON.stringify(chainBody),
          });
          const chainText = await chainResp.text();
          console.log(`Chain response: ${chainResp.status}`);
        } catch (e) {
          console.error(`Chain error: ${e.message}`);
        }
      } else {
        console.log(`Batch reanalyze COMPLETE. Final: ${JSON.stringify(stats)}`);
      }
    };

    // Use waitUntil to keep processing after response
    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(processAndChain());
    } else {
      await processAndChain();
    }

    // Respond immediately
    return new Response(
      JSON.stringify({
        success: true,
        status: 'processing',
        offset,
        batch_count: recs.length,
        stats,
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
