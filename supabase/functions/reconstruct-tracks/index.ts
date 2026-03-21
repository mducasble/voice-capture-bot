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
 * Flow:
 * 1. Fetch mixed recording + individual recordings for the session
 * 2. Download mixed WAV from S3
 * 3. Send mixed audio + ElevenLabs diarization to VPS /reconstruct-tracks
 * 4. VPS returns ZIP with per-speaker WAVs
 * 5. Upload each WAV to S3 (replacing old individual tracks)
 * 6. Update DB: file_url_history + reset statuses
 * 
 * Input JSON:
 *   { session_id: string, speaker_mapping?: Record<string, string> }
 * 
 * speaker_mapping (optional): maps VPS speaker labels to recording IDs
 *   e.g. { "speaker_A": "recording-uuid-1", "speaker_B": "recording-uuid-2" }
 *   If omitted, auto-maps by order (speaker_A → first individual, etc.)
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Admin auth check
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const userId = claimsData.claims.sub as string;

    // Check admin role
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { session_id, speaker_mapping } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. Fetch mixed + individual recordings for this session
    const { data: recordings, error: recErr } = await supabase
      .from('voice_recordings')
      .select('id, file_url, recording_type, discord_username, metadata, user_id, filename')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (recErr || !recordings?.length) {
      return new Response(JSON.stringify({ error: 'No recordings found for session' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const mixed = recordings.find(r => r.recording_type === 'mixed');
    const individuals = recordings.filter(r => r.recording_type === 'individual');

    if (!mixed) {
      return new Response(JSON.stringify({ error: 'No mixed recording found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!mixed.file_url) {
      return new Response(JSON.stringify({ error: 'Mixed recording has no file_url' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get diarization data from mixed recording metadata
    const mixedMeta = (mixed.metadata as Record<string, unknown>) || {};
    const elWords = mixedMeta.elevenlabs_words as Array<{
      text: string; start: number; end: number; speaker?: string;
    }> | null;

    if (!elWords || elWords.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Mixed recording has no ElevenLabs diarization data. Run transcription first.' 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Download mixed audio from S3
    console.log(`[Reconstruct] Downloading mixed audio: ${mixed.file_url}`);
    const mixedResp = await fetch(mixed.file_url);
    if (!mixedResp.ok) {
      return new Response(JSON.stringify({ error: `Failed to download mixed audio: ${mixedResp.status}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const mixedBlob = await mixedResp.blob();

    // 3. Send to VPS /reconstruct-tracks
    const metricsUrl = Deno.env.get('METRICS_API_URL');
    const metricsSecret = Deno.env.get('METRICS_API_SECRET');

    if (!metricsUrl) {
      return new Response(JSON.stringify({ error: 'METRICS_API_URL not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const formData = new FormData();
    formData.append('file', mixedBlob, mixed.filename || 'mixed.wav');
    formData.append('diarization', JSON.stringify(elWords));
    formData.append('session_prefix', session_id.substring(0, 8));

    console.log(`[Reconstruct] Sending to VPS: ${elWords.length} words`);
    const vpsResp = await fetch(`${metricsUrl}/reconstruct-tracks`, {
      method: 'POST',
      headers: {
        ...(metricsSecret ? { 'Authorization': `Bearer ${metricsSecret}` } : {}),
      },
      body: formData,
    });

    if (!vpsResp.ok) {
      const errText = await vpsResp.text();
      console.error(`VPS error: ${vpsResp.status} - ${errText}`);
      return new Response(JSON.stringify({ error: `VPS processing failed: ${vpsResp.status}`, details: errText }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Parse ZIP response
    const zipBuffer = await vpsResp.arrayBuffer();
    const zip = await JSZip.loadAsync(zipBuffer);
    const speakerFiles: Record<string, Uint8Array> = {};

    for (const [filename, file] of Object.entries(zip.files)) {
      if (!file.dir && filename.endsWith('.wav')) {
        const data = await (file as JSZip.JSZipObject).async('uint8array');
        // Extract speaker label from filename: e.g. "abc12345_speaker_A.wav" → "speaker_A"
        const match = filename.replace('.wav', '').split('_').slice(1).join('_');
        speakerFiles[match || filename] = data;
      }
    }

    const speakerLabels = Object.keys(speakerFiles).sort();
    console.log(`[Reconstruct] Got ${speakerLabels.length} speaker tracks: ${speakerLabels.join(', ')}`);

    // 5. Build speaker → recording mapping
    let mapping: Record<string, string> = {};
    if (speaker_mapping) {
      mapping = speaker_mapping;
    } else {
      // Auto-map by order: speaker_A → first individual, speaker_B → second, etc.
      for (let i = 0; i < Math.min(speakerLabels.length, individuals.length); i++) {
        mapping[speakerLabels[i]] = individuals[i].id;
      }
    }

    console.log(`[Reconstruct] Mapping: ${JSON.stringify(mapping)}`);

    // 6. Upload each WAV to S3 and update DB
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const results: Array<{ speaker: string; recording_id: string; success: boolean; error?: string }> = [];

    for (const [speaker, recordingId] of Object.entries(mapping)) {
      const wavData = speakerFiles[speaker];
      if (!wavData) {
        results.push({ speaker, recording_id: recordingId, success: false, error: 'Speaker not found in VPS output' });
        continue;
      }

      const targetRec = recordings.find(r => r.id === recordingId);
      if (!targetRec) {
        results.push({ speaker, recording_id: recordingId, success: false, error: 'Recording not found' });
        continue;
      }

      try {
        // Upload to S3 via stream-upload-to-s3
        const newFilename = `reconstructed_${speaker}_${Date.now()}.wav`;
        const uploadUrl = new URL(`${supabaseUrl}/functions/v1/stream-upload-to-s3`);
        uploadUrl.searchParams.set('filename', newFilename);
        uploadUrl.searchParams.set('folder', `rooms/${session_id}`);
        uploadUrl.searchParams.set('content_type', 'audio/wav');

        const uploadResp = await fetch(uploadUrl.toString(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'audio/wav',
          },
          body: wavData,
        });

        if (!uploadResp.ok) {
          const errText = await uploadResp.text();
          results.push({ speaker, recording_id: recordingId, success: false, error: `Upload failed: ${errText}` });
          continue;
        }

        const uploadResult = await uploadResp.json();
        const newFileUrl = uploadResult.public_url;

        // Update DB: same pattern as resubmit-track
        const currentMeta = (targetRec.metadata as Record<string, unknown>) || {};
        const fileHistory = (currentMeta.file_url_history as string[]) || [];
        if (targetRec.file_url) {
          fileHistory.push(targetRec.file_url);
        }

        const updatedMeta = {
          ...currentMeta,
          file_url_history: fileHistory,
          last_reconstructed_at: new Date().toISOString(),
          reconstruction_source: 'mixed',
          reconstruction_speaker_label: speaker,
        };

        const { error: updateErr } = await supabase
          .from('voice_recordings')
          .update({
            file_url: newFileUrl,
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
          .eq('id', recordingId);

        if (updateErr) {
          results.push({ speaker, recording_id: recordingId, success: false, error: updateErr.message });
        } else {
          results.push({ speaker, recording_id: recordingId, success: true });
          console.log(`[Reconstruct] Updated ${recordingId} (${speaker}) → ${newFileUrl}`);
        }
      } catch (err) {
        results.push({ speaker, recording_id: recordingId, success: false, error: String(err) });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const unmapped = speakerLabels.filter(s => !mapping[s]);

    return new Response(JSON.stringify({
      success: true,
      session_id,
      total_speakers: speakerLabels.length,
      mapped: Object.keys(mapping).length,
      updated: successCount,
      unmapped_speakers: unmapped,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Reconstruct] Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
