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

    const { recording_ids, campaign_id, offset = 0, _stats } = await req.json();

    if (!recording_ids && !campaign_id) {
      return new Response(JSON.stringify({ error: 'recording_ids array or campaign_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const stats = _stats || { triggered: 0, errors: 0, skipped: 0 };

    // Fetch ONE recording at current offset
    let query = supabase
      .from('voice_recordings')
      .select('id, file_url, mp3_file_url')
      .order('created_at', { ascending: true })
      .range(offset, offset);

    if (campaign_id) {
      query = query.eq('campaign_id', campaign_id);
    } else {
      query = query.in('id', recording_ids);
    }

    const { data: recordings, error } = await query;
    if (error) throw error;

    const rec = recordings?.[0];

    if (!rec) {
      // No more recordings — done
      console.log(`✅ BATCH COMPLETE at offset=${offset}. Final: triggered=${stats.triggered}, errors=${stats.errors}, skipped=${stats.skipped}`);
      return new Response(
        JSON.stringify({ success: true, status: 'complete', stats }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const audioUrl = rec.mp3_file_url || rec.file_url;

    if (!audioUrl) {
      console.warn(`⏭️ Skip ${rec.id}: no URL (offset=${offset})`);
      stats.skipped++;
    } else {
      // Process this single recording synchronously
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
          console.error(`❌ ${rec.id}: ${resp.status} (offset=${offset})`);
          stats.errors++;
        } else {
          stats.triggered++;
          console.log(`✓ ${rec.id} [${stats.triggered}] (offset=${offset})`);
        }
      } catch (e) {
        console.error(`❌ ${rec.id}: ${(e as Error).message} (offset=${offset})`);
        stats.errors++;
      }
    }

    // Always chain to next recording regardless of success/failure
    const nextOffset = offset + 1;
    const chainBody: Record<string, unknown> = {
      offset: nextOffset,
      _stats: stats,
    };
    if (campaign_id) chainBody.campaign_id = campaign_id;
    if (recording_ids) chainBody.recording_ids = recording_ids;

    // Small delay to avoid overloading the metrics API
    await new Promise(r => setTimeout(r, 1000));

    // Fire the chain call synchronously before responding (more reliable than waitUntil)
    try {
      const chainResp = await fetch(`${baseUrl}/functions/v1/batch-reanalyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(chainBody),
      });
      await chainResp.text(); // consume body
      console.log(`→ Chained to offset ${nextOffset}`);
    } catch (e) {
      console.error(`Chain fail at offset ${nextOffset}: ${(e as Error).message}`);
    }

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
        processed: rec.id,
        offset,
        next_offset: nextOffset,
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
