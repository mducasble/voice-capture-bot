import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Enhance audio via HuggingFace Space /enhance endpoint.
 * 
 * Flow:
 * 1. Download original WAV from S3 URL
 * 2. Send to HF Space /enhance with processing options
 * 3. Upload enhanced WAV back to S3
 * 4. Update recording metadata in DB
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      recording_id,
      file_url,
      // Enhancement options (all optional, defaults to recommended)
      normalize = true,
      highpass = true,
      highpass_freq = 80,
      lowpass = false,
      lowpass_freq = 16000,
      speech_eq = true,
      speech_eq_boost_db = 3,
      noise_gate = true,
      noise_gate_threshold_db = -40,
      target_lufs = -23,
    } = await req.json();

    if (!recording_id || !file_url) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id or file_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const METRICS_API_URL = Deno.env.get('METRICS_API_URL');
    const METRICS_API_SECRET = Deno.env.get('METRICS_API_SECRET');

    if (!METRICS_API_URL) {
      return new Response(
        JSON.stringify({ error: 'METRICS_API_URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- Step 1: Download original audio from S3 ---
    console.log(`[enhance] Downloading audio for recording ${recording_id}`);
    const audioResp = await fetch(file_url);
    if (!audioResp.ok) {
      throw new Error(`Failed to download audio: ${audioResp.status}`);
    }
    const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
    console.log(`[enhance] Downloaded ${(audioBytes.length / 1024 / 1024).toFixed(1)}MB`);

    // --- Step 2: Send to HF Space /enhance ---
    console.log(`[enhance] Sending to HF Space for enhancement...`);

    const isMP3 = file_url.toLowerCase().includes('.mp3');
    const mimeType = isMP3 ? 'audio/mpeg' : 'audio/wav';
    const filename = isMP3 ? 'audio.mp3' : 'audio.wav';
    const audioBlob = new Blob([audioBytes], { type: mimeType });

    function buildFormData(): FormData {
      const fd = new FormData();
      fd.append('file', audioBlob, filename);
      fd.append('normalize', String(normalize));
      fd.append('highpass', String(highpass));
      fd.append('highpass_freq', String(highpass_freq));
      fd.append('lowpass', String(lowpass));
      fd.append('lowpass_freq', String(lowpass_freq));
      fd.append('speech_eq', String(speech_eq));
      fd.append('speech_eq_boost_db', String(speech_eq_boost_db));
      fd.append('noise_gate', String(noise_gate));
      fd.append('noise_gate_threshold_db', String(noise_gate_threshold_db));
      fd.append('target_lufs', String(target_lufs));
      return fd;
    }

    const apiHeaders: Record<string, string> = {};
    if (METRICS_API_SECRET) {
      apiHeaders['Authorization'] = `Bearer ${METRICS_API_SECRET}`;
    }

    // Retry logic for sleeping HF Spaces
    let enhanceResp: Response | null = null;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      enhanceResp = await fetch(`${METRICS_API_URL}/enhance`, {
        method: 'POST',
        headers: apiHeaders,
        body: buildFormData(),
      });

      if (enhanceResp.ok) break;

      const errText = await enhanceResp.text();
      const isHtml = errText.trim().startsWith('<!DOCTYPE') || errText.trim().startsWith('<html');

      if (isHtml && attempt < maxRetries) {
        const waitSec = (attempt + 1) * 15;
        console.warn(`[enhance] HF Space may be waking up, retrying in ${waitSec}s...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        try { await fetch(`${METRICS_API_URL}/health`); } catch (_) { /* ignore */ }
        continue;
      }

      console.error(`[enhance] HF API error: ${enhanceResp.status}`, errText.substring(0, 200));
      throw new Error(`Enhancement API error: ${enhanceResp.status}`);
    }

    if (!enhanceResp || !enhanceResp.ok) {
      throw new Error('Enhancement API: max retries exceeded');
    }

    const enhancedBytes = new Uint8Array(await enhanceResp.arrayBuffer());
    const stepsApplied = enhanceResp.headers.get('X-Enhancement-Steps') || '';
    const originalRms = enhanceResp.headers.get('X-Original-RMS') || '';
    const enhancedRms = enhanceResp.headers.get('X-Enhanced-RMS') || '';
    console.log(`[enhance] Enhanced audio: ${(enhancedBytes.length / 1024 / 1024).toFixed(1)}MB | Steps: ${stepsApplied} | RMS: ${originalRms} → ${enhancedRms}`);

    // --- Step 3: Upload enhanced WAV to S3 ---
    const AWS_S3_REGION = Deno.env.get('AWS_S3_REGION') || 'us-east-1';
    const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID')!;
    const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY')!;
    const AWS_S3_BUCKET_NAME = Deno.env.get('AWS_S3_BUCKET_NAME')!;

    // Derive enhanced filename from original URL
    const originalPath = new URL(file_url).pathname;
    const pathParts = originalPath.split('/');
    const originalFilename = pathParts[pathParts.length - 1];
    const enhancedFilename = originalFilename.replace(/\.(wav|mp3)$/i, '_enhanced.wav');
    const s3Key = pathParts.slice(1, -1).join('/') + '/' + enhancedFilename;

    console.log(`[enhance] Uploading enhanced file to S3: ${s3Key}`);

    // Sign and upload to S3
    const s3Url = `https://${AWS_S3_BUCKET_NAME}.s3.${AWS_S3_REGION}.amazonaws.com/${s3Key}`;
    
    // Use AWS Signature V4 for PUT
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const shortDate = dateStamp.substring(0, 8);
    
    // Simple PUT with presigned-style headers
    const { createHmac, createHash } = await import("https://deno.land/std@0.168.0/node/crypto.ts");

    function hmacSha256(key: Uint8Array | string, data: string): Uint8Array {
      const hmac = createHmac('sha256', key);
      hmac.update(data);
      return new Uint8Array(hmac.digest() as ArrayBuffer);
    }

    function sha256Hex(data: Uint8Array | string): string {
      const hash = createHash('sha256');
      hash.update(data);
      return hash.digest('hex') as string;
    }

    const payloadHash = sha256Hex(enhancedBytes);
    const method = 'PUT';
    const canonicalUri = '/' + s3Key;
    const canonicalQueryString = '';
    const host = `${AWS_S3_BUCKET_NAME}.s3.${AWS_S3_REGION}.amazonaws.com`;

    const canonicalHeaders = [
      `content-type:audio/wav`,
      `host:${host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${dateStamp}`,
    ].join('\n') + '\n';

    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      method, canonicalUri, canonicalQueryString,
      canonicalHeaders, signedHeaders, payloadHash,
    ].join('\n');

    const credentialScope = `${shortDate}/${AWS_S3_REGION}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', dateStamp, credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmacSha256(`AWS4${AWS_SECRET_ACCESS_KEY}`, shortDate);
    const kRegion = hmacSha256(kDate, AWS_S3_REGION);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    
    const signatureHmac = createHmac('sha256', kSigning);
    signatureHmac.update(stringToSign);
    const signature = (signatureHmac.digest('hex') as string);

    const authorization = `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const uploadResp = await fetch(`https://${host}${canonicalUri}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/wav',
        'Host': host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': dateStamp,
        'Authorization': authorization,
      },
      body: enhancedBytes,
    });

    if (!uploadResp.ok) {
      const errBody = await uploadResp.text();
      console.error(`[enhance] S3 upload failed: ${uploadResp.status}`, errBody.substring(0, 300));
      throw new Error(`S3 upload failed: ${uploadResp.status}`);
    }

    const enhancedFileUrl = s3Url;
    console.log(`[enhance] Uploaded to: ${enhancedFileUrl}`);

    // --- Step 4: Update recording metadata (merge, don't overwrite) ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch existing metadata first
    const { data: existing } = await supabase
      .from('voice_recordings')
      .select('metadata')
      .eq('id', recording_id)
      .single();

    const existingMeta = (existing?.metadata as Record<string, unknown>) || {};
    const mergedMetadata = {
      ...existingMeta,
      enhanced_file_url: enhancedFileUrl,
      enhancement_steps: stepsApplied,
      enhancement_original_rms: originalRms,
      enhancement_enhanced_rms: enhancedRms,
      enhancement_date: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('voice_recordings')
      .update({ metadata: mergedMetadata })
      .eq('id', recording_id);

    if (updateError) {
      console.error(`[enhance] DB update error:`, updateError);
      // Don't fail — file is already uploaded successfully
    }

    return new Response(
      JSON.stringify({
        success: true,
        recording_id,
        enhanced_file_url: enhancedFileUrl,
        steps: stepsApplied,
        original_rms: originalRms,
        enhanced_rms: enhancedRms,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[enhance] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
