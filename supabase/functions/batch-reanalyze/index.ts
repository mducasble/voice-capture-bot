import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MAX_CONSECUTIVE_ERRORS = 3;
const CHAIN_DELAY_MS = 3000; // 3s between invocations

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // KILL SWITCH: must explicitly pass _kill_switch_off: true to process
  if (!body._kill_switch_off) {
    console.log('🛑 KILL SWITCH ACTIVE — stopping chain');
    return new Response(
      JSON.stringify({ success: true, status: 'killed', message: 'Kill switch active. Pass _kill_switch_off: true to resume.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { recording_ids, campaign_id, offset = 0, _stats } = body as {
      recording_ids?: string[];
      campaign_id?: string;
      offset?: number;
      _stats?: { triggered: number; errors: number; skipped: number; consecutive_errors: number };
      _kill_switch_off?: boolean;
    };

    if (!recording_ids && !campaign_id) {
      return new Response(JSON.stringify({ error: 'recording_ids array or campaign_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const stats = _stats || { triggered: 0, errors: 0, skipped: 0, consecutive_errors: 0 };

    // Circuit breaker: stop after too many consecutive errors
    if (stats.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`🔴 CIRCUIT BREAKER: ${stats.consecutive_errors} consecutive errors — halting chain`);
      return new Response(
        JSON.stringify({ success: false, status: 'circuit_breaker', stats, message: `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive errors` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    console.log(`▶ offset=${offset} rec=${rec.id} (ok=${stats.triggered} err=${stats.errors} consec_err=${stats.consecutive_errors})`);

    // Process SEQUENTIALLY: finish this recording, THEN chain to next
    const work = async () => {
      const audioUrl = rec.mp3_file_url || rec.file_url;
      let thisSucceeded = false;

      if (!audioUrl) {
        console.warn(`⏭ ${rec.id}: no URL`);
        stats.skipped++;
        thisSucceeded = true; // not an error, just skip
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
          const respText = await resp.text();

          // Detect HTML error pages (522, 503, etc.)
          if (respText.includes('<!DOCTYPE html>') || respText.includes('Connection timed out')) {
            console.error(`❌ ${rec.id}: upstream returned HTML error page`);
            stats.errors++;
            stats.consecutive_errors++;
          } else if (!resp.ok) {
            console.error(`❌ ${rec.id}: ${resp.status} — ${respText.substring(0, 200)}`);
            stats.errors++;
            stats.consecutive_errors++;
          } else {
            stats.triggered++;
            stats.consecutive_errors = 0; // reset on success
            thisSucceeded = true;
            console.log(`✓ ${rec.id} [${stats.triggered}]`);
          }
        } catch (e) {
          console.error(`❌ ${rec.id}: ${(e as Error).message}`);
          stats.errors++;
          stats.consecutive_errors++;
        }
      }

      // Check circuit breaker again after processing
      if (stats.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`🔴 CIRCUIT BREAKER after processing — halting chain`);
        return;
      }

      // Delay before chaining to avoid overwhelming infrastructure
      await new Promise(resolve => setTimeout(resolve, CHAIN_DELAY_MS));

      // Chain to next
      const nextOffset = offset + 1;
      try {
        const chainBody: Record<string, unknown> = {
          offset: nextOffset,
          _stats: stats,
          _kill_switch_off: true,
        };
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

    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work());
    } else {
      await work();
    }

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
