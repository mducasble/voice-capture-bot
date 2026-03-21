import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Reconstruct individual speaker tracks from a mixed recording.
 *
 * Modes:
 *   "preview" — sends file_url + diarization to VPS which downloads,
 *               separates, uploads WAVs to S3, returns preview URLs.
 *   "apply"   — Takes a confirmed speaker_label + target recording_id
 *               and applies the replacement (version history + status reset).
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

    if (mode === 'apply') {
      return await handleApply(supabase, body, corsHeaders);
    }

    if (mode === 'create') {
      return await handleCreate(supabase, body, corsHeaders);
    }

    return await handlePreview(supabase, supabaseUrl, serviceKey, session_id, corsHeaders);

  } catch (error) {
    console.error('[Reconstruct] Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ── PREVIEW: Send URL + diarization to VPS, VPS uploads to S3 ────
async function waitForDiarizationWords(
  supabase: any,
  recordingId: string,
  maxAttempts = 30,
  delayMs = 2000,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: mixedRec, error } = await supabase
      .from('voice_recordings')
      .select('transcription_elevenlabs_status, metadata')
      .eq('id', recordingId)
      .single();

    if (error) {
      throw error;
    }

    const metadata = (mixedRec?.metadata as Record<string, unknown>) || {};
    const words = metadata.elevenlabs_words as Array<{
      text: string; start: number; end: number; speaker?: string;
    }> | undefined;

    if (words?.length) {
      if (attempt > 0) {
        console.log(`[Reconstruct] Diarization became available after retry ${attempt}/${maxAttempts - 1}`);
      }
      return words;
    }

    const status = mixedRec?.transcription_elevenlabs_status;
    if (status === 'failed') {
      throw new Error('Mixed recording transcription failed before reconstruction');
    }

    if (attempt < maxAttempts - 1) {
      console.warn(`[Reconstruct] Diarization not ready yet for ${recordingId} (status=${status ?? 'unknown'}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return null;
}

async function handlePreview(
  supabase: any, supabaseUrl: string, serviceKey: string,
  session_id: string, cors: Record<string, string>
) {
  // 1. Fetch recordings
  const { data: recordings, error: recErr } = await supabase
    .from('voice_recordings')
    .select('id, file_url, recording_type, discord_username, metadata, user_id, filename, transcription_elevenlabs_status')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true });

  if (recErr || !recordings?.length) {
    console.warn(`[Reconstruct] No recordings found for session ${session_id}`);
    return new Response(JSON.stringify({ error: 'No recordings found for session' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const mixed = recordings.find((r: any) => r.recording_type === 'mixed');
  if (!mixed?.file_url) {
    console.warn(`[Reconstruct] No mixed recording with file_url for session ${session_id}`);
    return new Response(JSON.stringify({ error: 'No mixed recording with file_url found' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const elWords = await waitForDiarizationWords(supabase, mixed.id);
  if (!elWords?.length) {
    console.warn(`[Reconstruct] Diarization still unavailable for mixed ${mixed.id} in session ${session_id}`);
    return new Response(JSON.stringify({
      error: 'Mixed recording has no ElevenLabs diarization data yet. Try again in a few seconds.',
      status: 'waiting',
      recording_id: mixed.id,
    }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // 2. Send to VPS with file_url (VPS downloads directly + uploads to S3)
  const metricsUrl = Deno.env.get('METRICS_API_URL');
  const metricsSecret = Deno.env.get('METRICS_API_SECRET');
  if (!metricsUrl) {
    console.error('[Reconstruct] METRICS_API_URL not configured');
    return new Response(JSON.stringify({ error: 'METRICS_API_URL not configured' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const uploadBaseUrl = `${supabaseUrl}/functions/v1/stream-upload-to-s3`;
  const uploadFolder = `rooms/${session_id}/previews`;
  const sessionPrefix = session_id.substring(0, 8);

  const formData = new FormData();
  formData.append('file_url', mixed.file_url);
  formData.append('diarization', JSON.stringify(elWords));
  formData.append('session_prefix', sessionPrefix);
  formData.append('upload_base_url', uploadBaseUrl);
  formData.append('upload_auth', `Bearer ${serviceKey}`);
  formData.append('upload_folder', uploadFolder);

  console.log(`[Reconstruct] Sending to VPS: file_url mode, ${elWords.length} words`);
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

  // VPS now returns JSON with speaker URLs directly
  const result = await vpsResp.json();
  console.log(`[Reconstruct] Preview: ${result.speakers?.length || 0} speaker tracks uploaded by VPS`);

  return new Response(JSON.stringify({
    success: true,
    mode: 'preview',
    session_id,
    speakers: result.speakers || [],
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// ── APPLY: Replace a single track with chosen speaker WAV ───────
async function handleApply(
  supabase: any, body: any, cors: Record<string, string>
) {
  const { target_recording_id, speaker_label, preview_url } = body;

  if (!target_recording_id || !preview_url) {
    return new Response(JSON.stringify({ error: 'target_recording_id and preview_url are required' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

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
      status: 'completed',
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

// ── CREATE: Insert a new individual track from a reconstructed speaker WAV ──
async function handleCreate(
  supabase: any, body: any, cors: Record<string, string>
) {
  const { session_id, participant_name, speaker_label, preview_url } = body;

  if (!session_id || !participant_name || !preview_url) {
    return new Response(JSON.stringify({ error: 'session_id, participant_name, and preview_url are required' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Get a reference recording from the session to copy campaign_id, user_id, etc.
  const { data: refRec, error: refErr } = await supabase
    .from('voice_recordings')
    .select('campaign_id, user_id, discord_guild_id, discord_channel_id, discord_user_id')
    .eq('session_id', session_id)
    .limit(1)
    .single();

  if (refErr || !refRec) {
    return new Response(JSON.stringify({ error: 'No reference recording found for session' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const newFilename = `reconstructed_${participant_name.replace(/\s+/g, '_')}_${Date.now()}.wav`;

  const { data: newRec, error: insertErr } = await supabase
    .from('voice_recordings')
    .insert({
      session_id,
      campaign_id: refRec.campaign_id,
      user_id: refRec.user_id,
      discord_guild_id: refRec.discord_guild_id || 'reconstructed',
      discord_channel_id: refRec.discord_channel_id || 'reconstructed',
      discord_user_id: refRec.discord_user_id || 'reconstructed',
      discord_username: participant_name,
      file_url: preview_url,
      filename: newFilename,
      recording_type: 'individual',
      quality_status: 'pending',
      validation_status: 'pending',
      status: 'completed',
      metadata: {
        reconstructed_from: 'mixed',
        reconstruction_speaker_label: speaker_label,
        last_reconstructed_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[Reconstruct] Created new track for ${participant_name} → ${newRec.id}`);

  return new Response(JSON.stringify({
    success: true,
    mode: 'create',
    recording_id: newRec.id,
    participant_name,
    speaker_label,
    new_file_url: preview_url,
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}
