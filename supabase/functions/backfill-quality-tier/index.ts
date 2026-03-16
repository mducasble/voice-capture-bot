import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function computeQualityTier(meta: Record<string, unknown>): string {
  const snr = typeof meta.snr_db === 'number' ? meta.snr_db : null;
  const sigmos = typeof meta.sigmos_ovrl === 'number' ? meta.sigmos_ovrl : null;
  const srmr = typeof meta.srmr === 'number' ? meta.srmr : null;
  const rms = typeof meta.rms_dbfs === 'number' ? meta.rms_dbfs : null;

  if (snr !== null && snr >= 30 && sigmos !== null && sigmos >= 3.0 && srmr !== null && srmr >= 7.0 && rms !== null && rms >= -24) return 'pq';
  if (snr !== null && snr >= 25 && sigmos !== null && sigmos >= 2.3 && srmr !== null && srmr >= 5.4 && rms !== null && rms >= -26) return 'hq';
  if (sigmos !== null && sigmos >= 2.0 && srmr !== null && srmr >= 4.0 && rms !== null && rms >= -28) return 'mq';
  return 'lq';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { campaign_id, offset = 0, batch_size = 50 } = await req.json();
    if (!campaign_id) return new Response(JSON.stringify({ error: 'campaign_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Fetch batch of recordings that have metrics but no quality_tier
    const { data: recs, error } = await supabase
      .from('voice_recordings')
      .select('id, metadata')
      .eq('campaign_id', campaign_id)
      .not('metadata->metrics_estimated_at', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (error) throw error;
    if (!recs || recs.length === 0) {
      console.log(`✅ Done at offset=${offset}`);
      return new Response(JSON.stringify({ success: true, status: 'complete', offset }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let updated = 0;
    let skipped = 0;

    for (const rec of recs) {
      const meta = (rec.metadata || {}) as Record<string, unknown>;
      if (meta.quality_tier) { skipped++; continue; }
      
      const tier = computeQualityTier(meta);
      const { error: upErr } = await supabase
        .from('voice_recordings')
        .update({ metadata: { ...meta, quality_tier: tier } })
        .eq('id', rec.id);
      
      if (upErr) { console.error(`❌ ${rec.id}: ${upErr.message}`); }
      else { updated++; }
    }

    console.log(`offset=${offset} updated=${updated} skipped=${skipped} fetched=${recs.length}`);

    // Self-chain if there are more
    if (recs.length === batch_size) {
      const baseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const nextOffset = offset + batch_size;

      // @ts-ignore
      const chain = async () => {
        try {
          await fetch(`${baseUrl}/functions/v1/backfill-quality-tier`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({ campaign_id, offset: nextOffset, batch_size }),
          });
          console.log(`→ chained offset=${nextOffset}`);
        } catch (e) { console.error(`→ chain fail: ${(e as Error).message}`); }
      };

      // @ts-ignore
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(chain());
      } else {
        await chain();
      }
    }

    return new Response(JSON.stringify({ success: true, status: 'processing', offset, updated, skipped, fetched: recs.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
