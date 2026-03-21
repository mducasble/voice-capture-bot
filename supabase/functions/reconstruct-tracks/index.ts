import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Reconstruct individual speaker tracks from a mixed recording.
 *
 * Modes:
 *   "preview" (default) — VPS separates speakers, uploads WAVs to S3,
 *                          returns preview URLs for the user to listen & choose.
 *   "apply"            — Takes a confirmed speaker_label + target recording_id
 *                          and applies the replacement (version history + status reset).
 *
 * Input JSON:
 *   mode="preview": { session_id, mode?: "preview" }
 *   mode="apply":   { session_id, mode: "apply", target_recording_id, speaker_label, preview_url }
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check admin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError || !roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { session_id, mode = 'preview' } = body;

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── APPLY MODE ──────────────────────────────────────────────
    if (mode === 'apply') {
      return await handleApply(supabase, body, corsHeaders);
    }

    // ── PREVIEW MODE ────────────────────────────────────────────
    return await handlePreview(supabase, supabaseUrl, serviceKey, session_id, corsHeaders);

  } catch (error) {
    console.error('[Reconstruct] Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ── PREVIEW: Separate speakers, upload previews, return URLs ────
async function handlePreview(
  supabase: any, supabaseUrl: string, serviceKey: string,
  session_id: string, cors: Record<string, string>
) {
  // 1. Fetch recordings
  const { data: recordings, error: recErr } = await supabase
    .from('voice_recordings')
    .select('id, file_url, recording_type, discord_username, metadata, user_id, filename')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true });

  if (recErr || !recordings?.length) {
    return new Response(JSON.stringify({ error: 'No recordings found for session' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const mixed = recordings.find((r: any) => r.recording_type === 'mixed');
  if (!mixed?.file_url) {
    return new Response(JSON.stringify({ error: 'No mixed recording with file_url found' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Get diarization data
  const mixedMeta = (mixed.metadata as Record<string, unknown>) || {};
  const elWords = mixedMeta.elevenlabs_words as Array<{
    text: string; start: number; end: number; speaker?: string;
  }> | null;

  if (!elWords?.length) {
    return new Response(JSON.stringify({
      error: 'Mixed recording has no ElevenLabs diarization data. Run transcription first.'
    }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // 2. Download mixed audio
  console.log(`[Reconstruct] Downloading mixed audio: ${mixed.file_url}`);
  const mixedResp = await fetch(mixed.file_url);
  if (!mixedResp.ok) {
    return new Response(JSON.stringify({ error: `Failed to download mixed audio: ${mixedResp.status}` }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
  const mixedBlob = await mixedResp.blob();

  // 3. Send to VPS
  const metricsUrl = Deno.env.get('METRICS_API_URL');
  const metricsSecret = Deno.env.get('METRICS_API_SECRET');
  if (!metricsUrl) {
    return new Response(JSON.stringify({ error: 'METRICS_API_URL not configured' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const formData = new FormData();
  formData.append('file', mixedBlob, mixed.filename || 'mixed.wav');
  formData.append('diarization', JSON.stringify(elWords));
  formData.append('session_prefix', session_id.substring(0, 8));

  console.log(`[Reconstruct] Sending to VPS: ${elWords.length} words`);
  const vpsResp = await fetch(`${metricsUrl}/reconstruct-tracks`, {
    method: 'POST',
    headers: metricsSecret ? { 'Authorization': `Bearer ${metricsSecret}` } : {},
    body: formData,
  });

  if (!vpsResp.ok) {
    const errText = await vpsResp.text();
    console.error(`VPS error: ${vpsResp.status} - ${errText}`);
    return new Response(JSON.stringify({ error: `VPS processing failed: ${vpsResp.status}`, details: errText }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 4. Parse ZIP and upload each speaker WAV as preview
  const zipBuffer = await vpsResp.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);
  const previews: Array<{ speaker: string; url: string }> = [];

  for (const [filename, file] of Object.entries(zip.files)) {
    if (file.dir || !filename.endsWith('.wav')) continue;
    const data = await (file as any).async('uint8array');
    const speakerLabel = filename.replace('.wav', '').split('_').slice(1).join('_') || filename;

    // Upload to S3 as preview (temporary)
    const previewFilename = `preview_${speakerLabel}_${Date.now()}.wav`;
    const uploadUrl = new URL(`${supabaseUrl}/functions/v1/stream-upload-to-s3`);
    uploadUrl.searchParams.set('filename', previewFilename);
    uploadUrl.searchParams.set('folder', `rooms/${session_id}/previews`);
    uploadUrl.searchParams.set('content_type', 'audio/wav');

    const uploadResp = await fetch(uploadUrl.toString(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'audio/wav' },
      body: data,
    });

    if (uploadResp.ok) {
      const result = await uploadResp.json();
      previews.push({ speaker: speakerLabel, url: result.public_url });
    } else {
      console.error(`Failed to upload preview for ${speakerLabel}`);
    }
  }

  console.log(`[Reconstruct] Preview: ${previews.length} speaker tracks uploaded`);

  return new Response(JSON.stringify({
    success: true,
    mode: 'preview',
    session_id,
    speakers: previews,
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// ── APPLY: Replace a single track with chosen speaker WAV ───────
async function handleApply(
  supabase: any, body: any, cors: Record<string, string>
) {
  const { session_id, target_recording_id, speaker_label, preview_url } = body;

  if (!target_recording_id || !preview_url) {
    return new Response(JSON.stringify({ error: 'target_recording_id and preview_url are required' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Fetch target recording
  const { data: targetRec, error: targetErr } = await supabase
    .from('voice_recordings')
    .select('id, file_url, metadata, filename')
    .eq('id', target_recording_id)
    .single();

  if (targetErr || !targetRec) {
    return new Response(JSON.stringify({ error: 'Target recording not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Update DB: version history + replace URL + reset statuses
  const currentMeta = (targetRec.metadata as Record<string, unknown>) || {};
  const fileHistory = (currentMeta.file_url_history as string[]) || [];
  if (targetRec.file_url) {
    fileHistory.push(targetRec.file_url);
  }

  const newFilename = preview_url.split('/').pop() || `reconstructed_${speaker_label}_${Date.now()}.wav`;

  const updatedMeta = {
    ...currentMeta,
    file_url_history: fileHistory,
    last_reconstructed_at: new Date().toISOString(),
    reconstruction_source: 'mixed',
    reconstruction_speaker_label: speaker_label,
  };

  const { error: updateErr } = await supabase
    .from('voice_recordings')
    .update({
      file_url: preview_url,
      metadata: updatedMeta,
      quality_status: 'pending',
      validation_status: 'pending',
      quality_rejection_reason: null,
      validation_rejection_reason: null,
      quality_reviewed_at: null,
      quality_reviewed_by: null,
      validation_reviewed_at: null,
      validation_reviewed_by: null,
      snr_db: null,
      status: 'pending',
      filename: newFilename,
      updated_at: new Date().toISOString(),
    })
    .eq('id', target_recording_id);

  if (updateErr) {
    return new Response(JSON.stringify({ error: updateErr.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[Reconstruct] Applied ${speaker_label} → ${target_recording_id}`);

  return new Response(JSON.stringify({
    success: true,
    mode: 'apply',
    recording_id: target_recording_id,
    speaker_label,
    new_file_url: preview_url,
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}
