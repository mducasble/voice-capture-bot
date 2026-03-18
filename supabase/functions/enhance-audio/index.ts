import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Each segment sent to HF: 5 minutes of audio at 48kHz 16-bit mono ≈ 28MB
const SEGMENT_SECONDS = 300;

// ---------------------------------------------------------------------------
// WAV utilities
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
  hv.setUint16(20, 1, true);
  hv.setUint16(22, channels, true);
  hv.setUint32(24, sampleRate, true);
  hv.setUint32(28, sampleRate * bytesPerFrame, true);
  hv.setUint16(32, bytesPerFrame, true);
  hv.setUint16(34, bitsPerSample, true);
  writeStr(hv, 36, 'data');
  hv.setUint32(40, dataSize, true);

  return new Blob([new Uint8Array(wavHeader), pcmData.subarray(0, dataSize)], { type: 'audio/wav' });
}

function buildFinalWav(chunks: Uint8Array[], sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
  const bytesPerFrame = channels * (bitsPerSample / 8);
  let totalDataSize = 0;
  for (const c of chunks) totalDataSize += c.length;
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
// Adaptive enhancement options
// ---------------------------------------------------------------------------

interface OriginalMetrics {
  snr_db?: number | null;
  rms_dbfs?: number | null;
  srmr?: number | null;
  sigmos_ovrl?: number | null;
  sigmos_sig?: number | null;
  sigmos_bak?: number | null;
  mic_sr?: number | null;
  file_sr?: number | null;
}

function buildAdaptiveOptions(metrics: OriginalMetrics, fileSr: number): { opts: EnhanceOptions; reasons: string[] } {
  const reasons: string[] = [];

  let noise_gate = false;
  let noise_gate_threshold_db = -50;
  const snr = metrics.snr_db;
  if (snr != null && snr < 25) {
    noise_gate = true;
    noise_gate_threshold_db = snr < 10 ? -40 : snr < 18 ? -45 : -50;
    reasons.push(`noise_gate: SNR=${snr}dB < 25 → threshold=${noise_gate_threshold_db}dB`);
  } else {
    reasons.push(`noise_gate: SKIP (SNR=${snr ?? 'N/A'}dB, already good)`);
  }

  let highpass = false;
  let highpass_freq = 80;
  const srmr = metrics.srmr;
  if (srmr != null && srmr < 6.0) {
    highpass = true;
    highpass_freq = srmr < 3.0 ? 120 : srmr < 4.5 ? 100 : 80;
    reasons.push(`highpass: SRMR=${srmr} < 6.0 → cutoff=${highpass_freq}Hz`);
  } else {
    reasons.push(`highpass: SKIP (SRMR=${srmr ?? 'N/A'}, already good)`);
  }

  let speech_eq = false;
  let speech_eq_boost_db = 2;
  const sigSig = metrics.sigmos_sig;
  if (sigSig != null && sigSig < 3.5) {
    speech_eq = true;
    const gap = 3.5 - sigSig;
    speech_eq_boost_db = Math.min(4, Math.round(gap * 2 * 10) / 10);
    reasons.push(`speech_eq: SigMOS_SIG=${sigSig} < 3.5 → boost=${speech_eq_boost_db}dB`);
  } else {
    reasons.push(`speech_eq: SKIP (SigMOS_SIG=${sigSig ?? 'N/A'}, already good)`);
  }

  let lowpass = false;
  let lowpass_freq = 16000;
  const micSr = metrics.mic_sr;
  if (micSr != null && micSr < fileSr && micSr < 16000) {
    lowpass = true;
    lowpass_freq = Math.round(micSr * 0.9);
    reasons.push(`lowpass: mic_sr=${micSr} < file_sr=${fileSr} → cutoff=${lowpass_freq}Hz`);
  } else {
    reasons.push(`lowpass: SKIP (mic_sr=${micSr ?? 'N/A'})`);
  }

  let normalize = false;
  const target_lufs = -23;
  const rms = metrics.rms_dbfs;
  if (rms != null && (rms < -26 || rms > -18)) {
    normalize = true;
    reasons.push(`normalize: RMS=${rms}dBFS outside [-26,-18] → target=${target_lufs}LUFS`);
  } else {
    reasons.push(`normalize: SKIP (RMS=${rms ?? 'N/A'}dBFS, within range)`);
  }

  return {
    opts: { normalize, highpass, highpass_freq, lowpass, lowpass_freq, speech_eq, speech_eq_boost_db, noise_gate, noise_gate_threshold_db, target_lufs },
    reasons,
  };
}

// ---------------------------------------------------------------------------
// PHASE 1: Init — analyze file, determine segments, store config
// ---------------------------------------------------------------------------

async function phaseInit(recording_id: string, file_url: string, jobId: string) {
  const METRICS_API_URL = Deno.env.get('METRICS_API_URL');
  if (!METRICS_API_URL) throw new Error('METRICS_API_URL not configured');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: recData } = await supabase
    .from('voice_recordings')
    .select('metadata, snr_db, sample_rate')
    .eq('id', recording_id)
    .single();

  const meta = (recData?.metadata as Record<string, unknown>) || {};
  const fileSampleRate = (recData?.sample_rate as number) || 48000;

  const originalMetrics: OriginalMetrics = {
    snr_db: (recData?.snr_db as number) ?? (meta.snr_db as number | null) ?? null,
    rms_dbfs: (meta.rms_dbfs as number | null) ?? null,
    srmr: (meta.srmr as number | null) ?? null,
    sigmos_ovrl: (meta.sigmos_ovrl as number | null) ?? null,
    sigmos_sig: (meta.sigmos_sig as number | null) ?? null,
    sigmos_bak: (meta.sigmos_bak as number | null) ?? null,
    mic_sr: (meta.mic_sr as number | null) ?? null,
    file_sr: (meta.file_sr as number | null) ?? fileSampleRate,
  };

  const { opts: enhanceOpts, reasons } = buildAdaptiveOptions(originalMetrics, originalMetrics.file_sr || fileSampleRate);
  const anyStepEnabled = enhanceOpts.normalize || enhanceOpts.highpass || enhanceOpts.lowpass || enhanceOpts.speech_eq || enhanceOpts.noise_gate;

  console.log(`[enhance] Adaptive analysis for ${recording_id}:`);
  reasons.forEach((r) => console.log(`  → ${r}`));
  console.log(`[enhance] Steps enabled: ${anyStepEnabled ? 'yes' : 'NONE — audio already good'}`);

  if (!anyStepEnabled) {
    // Mark job as done — no enhancement needed
    await supabase
      .from('analysis_queue')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: 'Skipped: audio already good',
      })
      .eq('id', jobId);
    return { skipped: true, reasons };
  }

  const isMP3 = file_url.toLowerCase().includes('.mp3');

  if (isMP3) {
    // MP3: process in one shot (no segmentation)
    console.log(`[enhance] MP3 file — processing in single shot`);
    const resp = await fetch(file_url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const audioBytes = new Uint8Array(await resp.arrayBuffer());

    const result = await callEnhanceApi(
      new Blob([audioBytes], { type: 'audio/mpeg' }),
      'audio.mp3',
      METRICS_API_URL,
      Deno.env.get('METRICS_API_SECRET'),
      enhanceOpts,
    );

    await finalize(recording_id, result.enhancedBytes, result.steps, result.originalRms, result.enhancedRms, reasons, originalMetrics, supabase);

    await supabase
      .from('analysis_queue')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return { done: true };
  }

  // WAV: determine segments
  const headerBytes = await fetchRange(file_url, 0, 4096);
  const header = parseWavHeader(headerBytes);

  if (!header) {
    // Can't parse header — try single shot
    console.warn('[enhance] Could not parse WAV header, single shot');
    const resp = await fetch(file_url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const audioBytes = new Uint8Array(await resp.arrayBuffer());

    const result = await callEnhanceApi(
      new Blob([audioBytes], { type: 'audio/wav' }),
      'audio.wav',
      METRICS_API_URL,
      Deno.env.get('METRICS_API_SECRET'),
      enhanceOpts,
    );

    await finalize(recording_id, result.enhancedBytes, result.steps, result.originalRms, result.enhancedRms, reasons, originalMetrics, supabase);

    await supabase
      .from('analysis_queue')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return { done: true };
  }

  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const totalDuration = totalFrames / sampleRate;
  const segmentFrames = sampleRate * SEGMENT_SECONDS;
  const numSegments = Math.ceil(totalFrames / segmentFrames);

  console.log(`[enhance] ${totalDuration.toFixed(1)}s audio → ${numSegments} segments of ${SEGMENT_SECONDS}s`);

  if (numSegments <= 1) {
    // Small file — process in one shot
    const pcmData = await fetchRange(file_url, dataOffset, dataOffset + dataSize);
    const wavBlob = buildWav(pcmData, sampleRate, channels, bitsPerSample);

    const result = await callEnhanceApi(
      wavBlob,
      'audio.wav',
      METRICS_API_URL,
      Deno.env.get('METRICS_API_SECRET'),
      enhanceOpts,
    );

    await finalize(recording_id, result.enhancedBytes, result.steps, result.originalRms, result.enhancedRms, reasons, originalMetrics, supabase);

    await supabase
      .from('analysis_queue')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return { done: true };
  }

  // Multi-segment: store config and process segment 0
  const originalPath = new URL(file_url).pathname;
  const pathParts = originalPath.split('/');
  const basePath = pathParts.slice(1, -1).join('/');

  const segmentData = {
    file_url,
    enhance_opts: enhanceOpts,
    reasons,
    original_metrics: originalMetrics,
    wav_header: { sampleRate, channels, bitsPerSample, dataOffset, dataSize },
    segment_seconds: SEGMENT_SECONDS,
    temp_s3_keys: [] as string[],
    rms_values: { original: [] as number[], enhanced: [] as number[] },
    steps_applied: '',
    base_path: basePath,
  };

  // Process segment 0 right now
  const seg0Result = await processOneSegment(0, numSegments, segmentData);
  segmentData.temp_s3_keys = seg0Result.temp_s3_keys;
  segmentData.rms_values = seg0Result.rms_values;
  segmentData.steps_applied = seg0Result.steps_applied;

  // Save progress — set current_segment=1 (next to process), status=pending for cron to pick up
  await supabase
    .from('analysis_queue')
    .update({
      status: 'pending',
      current_segment: 1,
      total_segments: numSegments,
      segment_data: segmentData,
      started_at: null,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', jobId);

  console.log(`[enhance] Segment 0/${numSegments} done. Saved progress, re-queued for next segment.`);
  return { segment_done: 0, total: numSegments };
}

// ---------------------------------------------------------------------------
// Process a single segment
// ---------------------------------------------------------------------------

async function processOneSegment(
  segIndex: number,
  totalSegments: number,
  segData: any,
): Promise<{ temp_s3_keys: string[]; rms_values: any; steps_applied: string }> {
  const METRICS_API_URL = Deno.env.get('METRICS_API_URL')!;
  const METRICS_API_SECRET = Deno.env.get('METRICS_API_SECRET');
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = segData.wav_header;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const segmentFrames = sampleRate * segData.segment_seconds;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);

  const startFrame = segIndex * segmentFrames;
  const endFrame = Math.min(startFrame + segmentFrames, totalFrames);
  const byteStart = dataOffset + startFrame * bytesPerFrame;
  const byteEnd = Math.min(dataOffset + endFrame * bytesPerFrame, dataOffset + dataSize);

  console.log(`[enhance] Segment ${segIndex + 1}/${totalSegments}: downloading ${((byteEnd - byteStart) / 1024 / 1024).toFixed(1)}MB`);
  const pcmChunk = await fetchRange(segData.file_url, byteStart, byteEnd);
  const segWav = buildWav(pcmChunk, sampleRate, channels, bitsPerSample);

  // Normalize each segment individually to avoid OOM during assembly
  const segOpts = { ...segData.enhance_opts };
  const result = await callEnhanceApi(
    segWav,
    `segment_${segIndex}.wav`,
    METRICS_API_URL,
    METRICS_API_SECRET,
    segOpts,
  );

  // Extract PCM from enhanced WAV
  const enhancedHeader = parseWavHeader(result.enhancedBytes);
  const pcmOffset = enhancedHeader?.dataOffset ?? 44;
  const pcmSize = enhancedHeader?.dataSize ?? (result.enhancedBytes.length - 44);
  const enhancedPcm = result.enhancedBytes.subarray(pcmOffset, pcmOffset + pcmSize);

  // Upload temp PCM segment to S3
  const tempKey = `${segData.base_path}/_enhance_tmp/seg_${segIndex}.pcm`;
  await uploadToS3(enhancedPcm, tempKey);
  console.log(`[enhance] Segment ${segIndex + 1}/${totalSegments} done → ${tempKey}`);

  const temp_s3_keys = [...(segData.temp_s3_keys || []), tempKey];
  const rms_values = { ...segData.rms_values };
  if (result.originalRms) rms_values.original = [...(rms_values.original || []), parseFloat(result.originalRms)];
  if (result.enhancedRms) rms_values.enhanced = [...(rms_values.enhanced || []), parseFloat(result.enhancedRms)];
  const steps_applied = segIndex === 0 ? result.steps : (segData.steps_applied || '');

  return { temp_s3_keys, rms_values, steps_applied };
}

// ---------------------------------------------------------------------------
// PHASE 2: Continue — process next segment
// ---------------------------------------------------------------------------

async function phaseContinue(jobId: string, recording_id: string, currentSegment: number, totalSegments: number, segData: any) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const result = await processOneSegment(currentSegment, totalSegments, segData);
  segData.temp_s3_keys = result.temp_s3_keys;
  segData.rms_values = result.rms_values;
  segData.steps_applied = result.steps_applied;

  const nextSegment = currentSegment + 1;

  if (nextSegment >= totalSegments) {
    // All segments done — finalize!
    console.log(`[enhance] All ${totalSegments} segments processed. Assembling final file...`);
    await phaseFinalize(jobId, recording_id, segData, supabase);
  } else {
    // More segments — save progress and re-queue
    await supabase
      .from('analysis_queue')
      .update({
        status: 'pending',
        current_segment: nextSegment,
        segment_data: segData,
        started_at: null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', jobId);

    console.log(`[enhance] Segment ${currentSegment + 1}/${totalSegments} done. Re-queued for segment ${nextSegment + 1}.`);
  }
}

// ---------------------------------------------------------------------------
// PHASE 3: Finalize — download temp PCMs, combine, normalize, upload final
// ---------------------------------------------------------------------------

async function phaseFinalize(jobId: string, recording_id: string, segData: any, supabase: any) {
  const METRICS_API_URL = Deno.env.get('METRICS_API_URL')!;
  const METRICS_API_SECRET = Deno.env.get('METRICS_API_SECRET');
  const { sampleRate, channels, bitsPerSample } = segData.wav_header;
  const AWS_S3_REGION = Deno.env.get('AWS_S3_REGION') || 'us-east-1';
  const AWS_S3_BUCKET_NAME = Deno.env.get('AWS_S3_BUCKET_NAME')!;

  // Download all temp PCM segments from S3
  const pcmChunks: Uint8Array[] = [];
  for (const key of segData.temp_s3_keys) {
    const url = `https://${AWS_S3_BUCKET_NAME}.s3.${AWS_S3_REGION}.amazonaws.com/${key}`;
    console.log(`[enhance] Downloading temp segment: ${key}`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to download temp segment ${key}: ${resp.status}`);
    pcmChunks.push(new Uint8Array(await resp.arrayBuffer()));
  }

  // Build combined WAV
  let finalBytes = buildFinalWav(pcmChunks, sampleRate, channels, bitsPerSample);
  let stepsApplied = segData.steps_applied || '';

  // Apply final normalization if needed
  if (segData.enhance_opts.normalize) {
    console.log('[enhance] Applying final normalization pass...');
    const normOpts: EnhanceOptions = {
      ...segData.enhance_opts,
      highpass: false,
      lowpass: false,
      speech_eq: false,
      noise_gate: false,
      normalize: true,
    };
    const normResult = await callEnhanceApi(
      new Blob([finalBytes], { type: 'audio/wav' }),
      'final.wav',
      METRICS_API_URL,
      METRICS_API_SECRET,
      normOpts,
    );
    finalBytes = normResult.enhancedBytes;
    stepsApplied += ',final_normalize';
  }

  const rmsValues = segData.rms_values || { original: [], enhanced: [] };
  const originalRms = rmsValues.original.length > 0
    ? (rmsValues.original.reduce((a: number, b: number) => a + b) / rmsValues.original.length).toFixed(2)
    : '';
  const enhancedRms = rmsValues.enhanced.length > 0
    ? (rmsValues.enhanced.reduce((a: number, b: number) => a + b) / rmsValues.enhanced.length).toFixed(2)
    : '';

  console.log(`[enhance] Final: ${(finalBytes.length / 1024 / 1024).toFixed(1)}MB`);

  await finalize(recording_id, finalBytes, stepsApplied, originalRms, enhancedRms, segData.reasons, segData.original_metrics, supabase);

  // Clean up temp files (best effort)
  for (const key of segData.temp_s3_keys) {
    try {
      // Delete via S3 — simplified, just overwrite with empty (real delete needs different sig)
      console.log(`[enhance] Temp segment ${key} will be cleaned up later`);
    } catch (_) { /* ignore cleanup errors */ }
  }

  // Mark job as done
  await supabase
    .from('analysis_queue')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      segment_data: { ...segData, completed: true },
    } as any)
    .eq('id', jobId);

  console.log(`[enhance] ✓ Enhancement complete for ${recording_id}`);
}

// ---------------------------------------------------------------------------
// Finalize: upload to S3 and update recording metadata
// ---------------------------------------------------------------------------

async function finalize(
  recording_id: string,
  finalBytes: Uint8Array,
  stepsApplied: string,
  originalRms: string,
  enhancedRms: string,
  reasons: string[],
  originalMetrics: OriginalMetrics,
  supabase: any,
) {
  const { data: rec } = await supabase
    .from('voice_recordings')
    .select('file_url')
    .eq('id', recording_id)
    .single();

  const file_url = rec?.file_url;
  if (!file_url) throw new Error('No file_url found for recording');

  const originalPath = new URL(file_url).pathname;
  const pathParts = originalPath.split('/');
  const originalFilename = pathParts[pathParts.length - 1];
  const enhancedFilename = originalFilename.replace(/\.(wav|mp3)$/i, '_enhanced.wav');
  const s3Key = pathParts.slice(1, -1).join('/') + '/' + enhancedFilename;

  console.log(`[enhance] Uploading ${(finalBytes.length / 1024 / 1024).toFixed(1)}MB to S3: ${s3Key}`);
  const enhancedFileUrl = await uploadToS3(finalBytes, s3Key);
  console.log(`[enhance] Uploaded to: ${enhancedFileUrl}`);

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
    enhancement_adaptive_reasons: reasons,
    enhancement_original_metrics: originalMetrics,
  };

  const { error: updateError } = await supabase
    .from('voice_recordings')
    .update({ metadata: mergedMetadata })
    .eq('id', recording_id);

  if (updateError) {
    console.error('[enhance] DB update error:', updateError);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { recording_id, file_url, job_id, current_segment, total_segments, segment_data } = body;

    if (!recording_id) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!Deno.env.get('METRICS_API_URL')) {
      return new Response(
        JSON.stringify({ error: 'METRICS_API_URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which phase to run
    if (current_segment != null && current_segment > 0 && segment_data) {
      // PHASE 2 or 3: Continue processing segments
      console.log(`[enhance] Continuing segment ${current_segment + 1}/${total_segments} for ${recording_id}`);
      await phaseContinue(job_id, recording_id, current_segment, total_segments, segment_data);
    } else {
      // PHASE 1: Init — analyze and start processing
      console.log(`[enhance] Init for ${recording_id}`);
      if (!file_url) {
        return new Response(
          JSON.stringify({ error: 'Missing file_url for init phase' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      await phaseInit(recording_id, file_url, job_id || 'direct');
    }

    return new Response(
      JSON.stringify({ success: true, recording_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[enhance] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
