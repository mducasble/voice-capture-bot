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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // 1. Check if there's a global pause flag
    const { data: config } = await supabase
      .from('maintenance_config')
      .select('is_active')
      .limit(1)
      .single();

    if (config?.is_active) {
      return new Response(
        JSON.stringify({ status: 'paused', reason: 'maintenance_active' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Release stuck jobs
    // Analyze jobs: stuck > 5 min
    // Enhance jobs: stuck > 15 min (they take longer)
    const now = Date.now();
    await supabase
      .from('analysis_queue')
      .update({ status: 'pending', started_at: null, updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .neq('job_type', 'enhance')
      .lt('started_at', new Date(now - 5 * 60 * 1000).toISOString());

    await supabase
      .from('analysis_queue')
      .update({ status: 'pending', started_at: null, updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .eq('job_type', 'enhance')
      .lt('started_at', new Date(now - 15 * 60 * 1000).toISOString());

    // 3. Claim ONE pending job (highest priority, oldest first)
    const { data: jobs, error: fetchErr } = await supabase
      .from('analysis_queue')
      .select('id, recording_id, attempts, max_attempts, job_type')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (fetchErr) throw fetchErr;

    const job = jobs?.[0];
    if (!job) {
      return new Response(
        JSON.stringify({ status: 'idle', message: 'No pending jobs' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Mark as processing (optimistic lock)
    const { error: claimErr } = await supabase
      .from('analysis_queue')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'pending');

    if (claimErr) throw claimErr;

    // 5. Get recording info
    const { data: rec, error: recErr } = await supabase
      .from('voice_recordings')
      .select('id, file_url, mp3_file_url')
      .eq('id', job.recording_id)
      .single();

    if (recErr || !rec) {
      await supabase
        .from('analysis_queue')
        .update({
          status: 'failed',
          last_error: recErr?.message || 'Recording not found',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return new Response(
        JSON.stringify({ status: 'failed', job_id: job.id, error: 'Recording not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioUrl = rec.mp3_file_url || rec.file_url;
    if (!audioUrl) {
      await supabase
        .from('analysis_queue')
        .update({
          status: 'done',
          last_error: 'No audio URL, skipped',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return new Response(
        JSON.stringify({ status: 'skipped', job_id: job.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Route to the correct function based on job_type
    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const jobType = (job as any).job_type || 'analyze';

    if (jobType === 'enhance') {
      // Fire-and-forget: enhance-audio can take 5-10 min for large files
      // It will update the DB directly; we just need to mark the queue job
      const enhancePromise = (async () => {
        try {
          const resp = await fetch(`${baseUrl}/functions/v1/enhance-audio`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              recording_id: rec.id,
              file_url: rec.file_url || audioUrl,
            }),
          });

          const respText = await resp.text();

          if (!resp.ok || respText.includes('<!DOCTYPE html>')) {
            const errorMsg = `HTTP ${resp.status}: ${respText.substring(0, 200)}`;
            const newStatus = (job.attempts + 1) >= job.max_attempts ? 'failed' : 'pending';
            await supabase
              .from('analysis_queue')
              .update({
                status: newStatus,
                last_error: errorMsg,
                started_at: null,
                updated_at: new Date().toISOString(),
                ...(newStatus === 'failed' ? { completed_at: new Date().toISOString() } : {}),
              })
              .eq('id', job.id);
            console.error(`❌ Enhance job ${job.id} rec=${rec.id}: ${errorMsg}`);
          } else {
            // Parse response to check if skipped
            let parsed: any = {};
            try { parsed = JSON.parse(respText); } catch (_) { /* ok */ }

            await supabase
              .from('analysis_queue')
              .update({
                status: 'done',
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_error: parsed.skipped ? 'Skipped: audio already good' : null,
              })
              .eq('id', job.id);
            console.log(`✓ Enhance job ${job.id} rec=${rec.id} done`);
          }
        } catch (err) {
          const errorMsg = (err as Error).message || 'Unknown error';
          const newStatus = (job.attempts + 1) >= job.max_attempts ? 'failed' : 'pending';
          await supabase
            .from('analysis_queue')
            .update({
              status: newStatus,
              last_error: errorMsg,
              started_at: null,
              updated_at: new Date().toISOString(),
              ...(newStatus === 'failed' ? { completed_at: new Date().toISOString() } : {}),
            })
            .eq('id', job.id);
          console.error(`❌ Enhance job ${job.id} error: ${errorMsg}`);
        }
      })();

      // Use waitUntil so the background work continues after response
      (globalThis as any).EdgeRuntime?.waitUntil?.(enhancePromise);

      console.log(`🔄 Enhance job ${job.id} rec=${rec.id} fired (async)`);
      return new Response(
        JSON.stringify({ status: 'dispatched', job_id: job.id, recording_id: rec.id, job_type: 'enhance' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Standard analyze job
    console.log(`🔄 Analyze job ${job.id} rec=${rec.id}`);
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

    if (respText.includes('<!DOCTYPE html>') || respText.includes('Connection timed out') || !resp.ok) {
      const errorMsg = !resp.ok
        ? `HTTP ${resp.status}: ${respText.substring(0, 200)}`
        : 'Upstream HTML error';

      const newStatus = (job.attempts + 1) >= job.max_attempts ? 'failed' : 'pending';

      await supabase
        .from('analysis_queue')
        .update({
          status: newStatus,
          last_error: errorMsg,
          started_at: null,
          updated_at: new Date().toISOString(),
          ...(newStatus === 'failed' ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq('id', job.id);

      console.error(`❌ Job ${job.id} rec=${rec.id}: ${errorMsg}`);
      return new Response(
        JSON.stringify({ status: 'error', job_id: job.id, error: errorMsg }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Success!
    await supabase
      .from('analysis_queue')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    console.log(`✓ Job ${job.id} rec=${rec.id} done`);
    return new Response(
      JSON.stringify({ status: 'done', job_id: job.id, recording_id: rec.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Worker error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
