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

    // 2. Release stuck jobs (processing > 5 min = likely dead)
    await supabase
      .from('analysis_queue')
      .update({ status: 'pending', started_at: null, updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .lt('started_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

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
      .eq('status', 'pending'); // CAS: only if still pending

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

    let targetFunction: string;
    let requestBody: Record<string, unknown>;

    if (jobType === 'enhance') {
      targetFunction = 'enhance-audio';
      // Always use original file_url for enhancement (not mp3)
      requestBody = {
        recording_id: rec.id,
        file_url: rec.file_url || audioUrl,
      };
    } else {
      targetFunction = 'estimate-audio-metrics';
      requestBody = {
        recording_id: rec.id,
        file_url: audioUrl,
        mode: 'sampled',
      };
    }

    console.log(`🔄 Job ${job.id} type=${jobType} rec=${rec.id} → ${targetFunction}`);

    const resp = await fetch(`${baseUrl}/functions/v1/${targetFunction}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const respText = await resp.text();

    // Detect HTML error pages or non-OK
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

    console.log(`✓ Job ${job.id} type=${jobType} rec=${rec.id} done`);
    return new Response(
      JSON.stringify({ status: 'done', job_id: job.id, recording_id: rec.id, job_type: jobType }),
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
