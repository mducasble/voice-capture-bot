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
      console.log(`✅ DONE offset=${offset} | ok=${stats.triggered} err=${stats.errors} skip=${stats.skipped}`);
      return new Response(
        JSON.stringify({ success: true, status: 'complete', stats }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    console.log(`▶ offset=${offset} rec=${rec.id} (ok=${stats.triggered} err=${stats.errors})`);

    // Background: process this recording then chain
    const work = async () => {
      const audioUrl = rec.mp3_file_url || rec.file_url;
      if (!audioUrl) {
        console.warn(`⏭ ${rec.id}: no URL`);
        stats.skipped++;
      } else {
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
            console.error(`❌ ${rec.id}: ${resp.status}`);
            stats.errors++;
          } else {
            stats.triggered++;
            console.log(`✓ ${rec.id} [${stats.triggered}]`);
          }
        } catch (e) {
          console.error(`❌ ${rec.id}: ${(e as Error).message}`);
          stats.errors++;
        }
      }

      // Chain to next — this POST returns fast since next invocation also responds immediately
      const nextOffset = offset + 1;
      try {
        const chainBody: Record<string, unknown> = { offset: nextOffset, _stats: stats };
        if (campaign_id) chainBody.campaign_id = campaign_id;
        if (recording_ids) chainBody.recording_ids = recording_ids;

        const cr = await fetch(`${baseUrl}/functions/v1/batch-reanalyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify(chainBody),
        });
        await cr.text();
        console.log(`→ chained ${nextOffset}`);
      } catch (e) {
        console.error(`→ chain fail ${nextOffset}: ${(e as Error).message}`);
      }
    };

    // @ts-ignore - EdgeRuntime.waitUntil keeps work alive after response (~150s max)
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work());
    } else {
      await work();
    }

    // Respond immediately so the caller doesn't block
    return new Response(
      JSON.stringify({ success: true, status: 'processing', offset, rec: rec.id, stats }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
