import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Each segment sent to HF: 5 minutes of audio at 48kHz 16-bit mono ≈ 28MB
const SEGMENT_SECONDS = 300; // 5 minutes per chunk

// ---------------------------------------------------------------------------
// WAV utilities (reused from estimate-audio-metrics pattern)
// ---------------------------------------------------------------------------

interface WavHeader {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

function parseWavHeader(bytes: Uint8Array): WavHeader | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (riff !== 'RIFF') return null;
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (wave !== 'WAVE') return null;

  let offset = 12;
  let sampleRate = 48000, channels = 2, bitsPerSample = 16, dataOffset = 0, dataSize = 0;

  while (offset < Math.min(bytes.length - 8, 1000)) {
    const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }
  if (dataOffset === 0) return null;
  return { sampleRate, channels, bitsPerSample, dataOffset, dataSize };
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function buildWav(pcmData: Uint8Array, sampleRate: number, channels: number, bitsPerSample: number): Blob {
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const numFrames = Math.floor(pcmData.length / bytesPerFrame);
  const dataSize = numFrames * bytesPerFrame;
  const wavHeader = new ArrayBuffer(44);
  const hv = new DataView(wavHeader);

  writeStr(hv, 0, 'RIFF');
  hv.setUint32(4, 36 + dataSize, true);
  writeStr(hv, 8, 'WAVE');
  writeStr(hv, 12, 'fmt ');
  hv.setUint32(16, 16, true);
  hv.setUint16(20, 1, true); // PCM
  hv.setUint16(22, channels, true);
  hv.setUint32(24, sampleRate, true);
  hv.setUint32(28, sampleRate * bytesPerFrame, true);
  hv.setUint16(32, bytesPerFrame, true);
  hv.setUint16(34, bitsPerSample, true);
  writeStr(hv, 36, 'data');
  hv.setUint32(40, dataSize, true);

  return new Blob([new Uint8Array(wavHeader), pcmData.subarray(0, dataSize)], { type: 'audio/wav' });
}

/** Build a final WAV from multiple PCM chunks */
function buildFinalWav(chunks: Uint8Array[], sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
  const bytesPerFrame = channels * (bitsPerSample / 8);
  let totalDataSize = 0;
  for (const c of chunks) totalDataSize += c.length;
  // Align to frame boundary
  totalDataSize = Math.floor(totalDataSize / bytesPerFrame) * bytesPerFrame;

  const result = new Uint8Array(44 + totalDataSize);
  const hv = new DataView(result.buffer);

  writeStr(hv, 0, 'RIFF');
  hv.setUint32(4, 36 + totalDataSize, true);
  writeStr(hv, 8, 'WAVE');
  writeStr(hv, 12, 'fmt ');
  hv.setUint32(16, 16, true);
  hv.setUint16(20, 1, true);
  hv.setUint16(22, channels, true);
  hv.setUint32(24, sampleRate, true);
  hv.setUint32(28, sampleRate * bytesPerFrame, true);
  hv.setUint16(32, bytesPerFrame, true);
  hv.setUint16(34, bitsPerSample, true);
  writeStr(hv, 36, 'data');
  hv.setUint32(40, totalDataSize, true);

  let offset = 44;
  for (const chunk of chunks) {
    const usable = Math.min(chunk.length, totalDataSize - (offset - 44));
    result.set(chunk.subarray(0, usable), offset);
    offset += usable;
  }

  return result;
}

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const resp = await fetch(url, { headers: { 'Range': `bytes=${start}-${end - 1}` } });
  if (resp.status === 206 || resp.ok) {
    return new Uint8Array(await resp.arrayBuffer());
  }
  throw new Error(`Range request failed: ${resp.status}`);
}

// ---------------------------------------------------------------------------
// HF Space /enhance caller with retry
// ---------------------------------------------------------------------------

interface EnhanceOptions {
  normalize: boolean;
  highpass: boolean;
  highpass_freq: number;
  lowpass: boolean;
  lowpass_freq: number;
  speech_eq: boolean;
  speech_eq_boost_db: number;
  noise_gate: boolean;
  noise_gate_threshold_db: number;
  target_lufs: number;
}

async function callEnhanceApi(
  audioBlob: Blob,
  filename: string,
  apiUrl: string,
  apiSecret: string | undefined,
  opts: EnhanceOptions,
): Promise<{ enhancedBytes: Uint8Array; steps: string; originalRms: string; enhancedRms: string }> {
  const maxRetries = 2;

  function buildForm(): FormData {
    const fd = new FormData();
    fd.append('file', audioBlob, filename);
    fd.append('normalize', String(opts.normalize));
    fd.append('highpass', String(opts.highpass));
    fd.append('highpass_freq', String(opts.highpass_freq));
    fd.append('lowpass', String(opts.lowpass));
    fd.append('lowpass_freq', String(opts.lowpass_freq));
    fd.append('speech_eq', String(opts.speech_eq));
    fd.append('speech_eq_boost_db', String(opts.speech_eq_boost_db));
    fd.append('noise_gate', String(opts.noise_gate));
    fd.append('noise_gate_threshold_db', String(opts.noise_gate_threshold_db));
    fd.append('target_lufs', String(opts.target_lufs));
    return fd;
  }

  const headers: Record<string, string> = {};
  if (apiSecret) headers['Authorization'] = `Bearer ${apiSecret}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(`${apiUrl}/enhance`, {
      method: 'POST',
      headers,
      body: buildForm(),
    });

    if (resp.ok) {
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return {
        enhancedBytes: bytes,
        steps: resp.headers.get('X-Enhancement-Steps') || '',
        originalRms: resp.headers.get('X-Original-RMS') || '',
        enhancedRms: resp.headers.get('X-Enhanced-RMS') || '',
      };
    }

    const errText = await resp.text();
    const isHtml = errText.trim().startsWith('<!DOCTYPE') || errText.trim().startsWith('<html');

    if (isHtml && attempt < maxRetries) {
      const waitSec = (attempt + 1) * 15;
      console.warn(`[enhance] HF Space waking up, retry in ${waitSec}s...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      try { await fetch(`${apiUrl}/health`); } catch (_) { /* ignore */ }
      continue;
    }

    throw new Error(`Enhancement API error: ${resp.status} - ${errText.substring(0, 200)}`);
  }

  throw new Error('Enhancement API: max retries exceeded');
}

// ---------------------------------------------------------------------------
// S3 upload with AWS Sig V4
// ---------------------------------------------------------------------------

async function uploadToS3(data: Uint8Array, s3Key: string): Promise<string> {
  const AWS_S3_REGION = Deno.env.get('AWS_S3_REGION') || 'us-east-1';
  const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID')!;
  const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY')!;
  const AWS_S3_BUCKET_NAME = Deno.env.get('AWS_S3_BUCKET_NAME')!;

  const { createHmac, createHash } = await import("https://deno.land/std@0.168.0/node/crypto.ts");

  function hmacSha256(key: Uint8Array | string, d: string): Uint8Array {
    const hmac = createHmac('sha256', key);
    hmac.update(d);
    return new Uint8Array(hmac.digest() as ArrayBuffer);
  }

  function sha256Hex(d: Uint8Array | string): string {
    const hash = createHash('sha256');
    hash.update(d);
    return hash.digest('hex') as string;
  }

  const host = `${AWS_S3_BUCKET_NAME}.s3.${AWS_S3_REGION}.amazonaws.com`;
  const s3Url = `https://${host}/${s3Key}`;
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const shortDate = dateStamp.substring(0, 8);

  const payloadHash = sha256Hex(data);
  const canonicalUri = '/' + s3Key;
  const canonicalHeaders = `content-type:audio/wav\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${dateStamp}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${shortDate}/${AWS_S3_REGION}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${dateStamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmacSha256(`AWS4${AWS_SECRET_ACCESS_KEY}`, shortDate);
  const kRegion = hmacSha256(kDate, AWS_S3_REGION);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const sigHmac = createHmac('sha256', kSigning);
  sigHmac.update(stringToSign);
  const signature = sigHmac.digest('hex') as string;

  const authorization = `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const resp = await fetch(s3Url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'audio/wav',
      'Host': host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': dateStamp,
      'Authorization': authorization,
    },
    body: data,
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`S3 upload failed: ${resp.status} - ${errBody.substring(0, 300)}`);
  }

  return s3Url;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      recording_id,
      file_url,
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

    const enhanceOpts: EnhanceOptions = {
      normalize, highpass, highpass_freq, lowpass, lowpass_freq,
      speech_eq, speech_eq_boost_db, noise_gate, noise_gate_threshold_db, target_lufs,
    };

    const isMP3 = file_url.toLowerCase().includes('.mp3');
    let stepsApplied = '';
    let originalRms = '';
    let enhancedRms = '';
    let finalBytes: Uint8Array;

    if (isMP3) {
      // MP3: must download full (can't Range-parse without decoder)
      console.log(`[enhance] MP3 file — downloading full`);
      const resp = await fetch(file_url);
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      const audioBytes = new Uint8Array(await resp.arrayBuffer());
      console.log(`[enhance] MP3: ${(audioBytes.length / 1024 / 1024).toFixed(1)}MB`);

      const result = await callEnhanceApi(
        new Blob([audioBytes], { type: 'audio/mpeg' }), 'audio.mp3',
        METRICS_API_URL, METRICS_API_SECRET, enhanceOpts,
      );
      finalBytes = result.enhancedBytes;
      stepsApplied = result.steps;
      originalRms = result.originalRms;
      enhancedRms = result.enhancedRms;
    } else {
      // WAV: use Range Requests for chunked processing
      console.log(`[enhance] WAV file — fetching header`);
      const headerBytes = await fetchRange(file_url, 0, 4096);
      const header = parseWavHeader(headerBytes);

      if (!header) {
        // Fallback: download full file
        console.warn('[enhance] Could not parse WAV header, downloading full');
        const resp = await fetch(file_url);
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
        const audioBytes = new Uint8Array(await resp.arrayBuffer());

        const result = await callEnhanceApi(
          new Blob([audioBytes], { type: 'audio/wav' }), 'audio.wav',
          METRICS_API_URL, METRICS_API_SECRET, enhanceOpts,
        );
        finalBytes = result.enhancedBytes;
        stepsApplied = result.steps;
        originalRms = result.originalRms;
        enhancedRms = result.enhancedRms;
      } else {
        const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
        const bytesPerFrame = channels * (bitsPerSample / 8);
        const totalFrames = Math.floor(dataSize / bytesPerFrame);
        const totalDuration = totalFrames / sampleRate;
        const segmentFrames = sampleRate * SEGMENT_SECONDS;
        const numSegments = Math.ceil(totalFrames / segmentFrames);

        console.log(`[enhance] ${totalDuration.toFixed(1)}s audio → ${numSegments} segments of ${SEGMENT_SECONDS}s`);

        if (numSegments <= 1) {
          // Short file: download full data and enhance in one go
          const pcmData = await fetchRange(file_url, dataOffset, dataOffset + dataSize);
          const wavBlob = buildWav(pcmData, sampleRate, channels, bitsPerSample);

          const result = await callEnhanceApi(
            wavBlob, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET, enhanceOpts,
          );
          finalBytes = result.enhancedBytes;
          stepsApplied = result.steps;
          originalRms = result.originalRms;
          enhancedRms = result.enhancedRms;
        } else {
          // Large file: process segment by segment
          const enhancedPcmChunks: Uint8Array[] = [];
          const rmsValues: { original: number[]; enhanced: number[] } = { original: [], enhanced: [] };

          for (let seg = 0; seg < numSegments; seg++) {
            const startFrame = seg * segmentFrames;
            const endFrame = Math.min(startFrame + segmentFrames, totalFrames);
            const framesInSegment = endFrame - startFrame;

            const byteStart = dataOffset + startFrame * bytesPerFrame;
            const byteEnd = Math.min(dataOffset + endFrame * bytesPerFrame, dataOffset + dataSize);

            console.log(`[enhance] Segment ${seg + 1}/${numSegments}: downloading ${((byteEnd - byteStart) / 1024 / 1024).toFixed(1)}MB`);
            const pcmChunk = await fetchRange(file_url, byteStart, byteEnd);
            const segWav = buildWav(pcmChunk, sampleRate, channels, bitsPerSample);

            // For segments after the first, skip normalization — we'll normalize the final file
            const segOpts = { ...enhanceOpts, normalize: false };
            const result = await callEnhanceApi(
              segWav, `segment_${seg}.wav`, METRICS_API_URL, METRICS_API_SECRET, segOpts,
            );

            if (seg === 0) stepsApplied = result.steps;
            if (result.originalRms) rmsValues.original.push(parseFloat(result.originalRms));
            if (result.enhancedRms) rmsValues.enhanced.push(parseFloat(result.enhancedRms));

            // Extract PCM from the enhanced WAV (skip 44-byte header)
            const enhancedHeader = parseWavHeader(result.enhancedBytes);
            const pcmOffset = enhancedHeader?.dataOffset ?? 44;
            const pcmSize = enhancedHeader?.dataSize ?? (result.enhancedBytes.length - 44);
            enhancedPcmChunks.push(result.enhancedBytes.subarray(pcmOffset, pcmOffset + pcmSize));

            console.log(`[enhance] Segment ${seg + 1}/${numSegments} done`);
          }

          // Concatenate all enhanced PCM into final WAV
          finalBytes = buildFinalWav(enhancedPcmChunks, sampleRate, channels, bitsPerSample);

          // If normalization was requested, send the concatenated file for normalization only
          if (enhanceOpts.normalize) {
            console.log(`[enhance] Applying final normalization pass...`);
            const normOpts: EnhanceOptions = {
              ...enhanceOpts,
              highpass: false, lowpass: false, speech_eq: false, noise_gate: false,
              normalize: true,
            };
            const normResult = await callEnhanceApi(
              new Blob([finalBytes], { type: 'audio/wav' }), 'final.wav',
              METRICS_API_URL, METRICS_API_SECRET, normOpts,
            );
            finalBytes = normResult.enhancedBytes;
            stepsApplied += ',final_normalize';
          }

          originalRms = rmsValues.original.length > 0
            ? (rmsValues.original.reduce((a, b) => a + b) / rmsValues.original.length).toFixed(2)
            : '';
          enhancedRms = rmsValues.enhanced.length > 0
            ? (rmsValues.enhanced.reduce((a, b) => a + b) / rmsValues.enhanced.length).toFixed(2)
            : '';

          console.log(`[enhance] All ${numSegments} segments processed. Final: ${(finalBytes.length / 1024 / 1024).toFixed(1)}MB`);
        }
      }
    }

    // --- Upload to S3 ---
    const originalPath = new URL(file_url).pathname;
    const pathParts = originalPath.split('/');
    const originalFilename = pathParts[pathParts.length - 1];
    const enhancedFilename = originalFilename.replace(/\.(wav|mp3)$/i, '_enhanced.wav');
    const s3Key = pathParts.slice(1, -1).join('/') + '/' + enhancedFilename;

    console.log(`[enhance] Uploading ${(finalBytes.length / 1024 / 1024).toFixed(1)}MB to S3: ${s3Key}`);
    const enhancedFileUrl = await uploadToS3(finalBytes, s3Key);
    console.log(`[enhance] Uploaded to: ${enhancedFileUrl}`);

    // --- Update DB metadata (merge) ---
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

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
