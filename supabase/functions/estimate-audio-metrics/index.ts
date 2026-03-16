import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sampling config
const SEGMENT_SECONDS = 60;
const SAMPLE_SECONDS = 10;
const MAX_SAMPLES = 5; // Max segments to sample (avoid timeout on very long files)

// Parse WAV header from a small buffer (first ~1000 bytes)
function parseWavHeader(bytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number } | null {
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

/** Build a WAV blob from raw PCM data chunks */
function buildWav(chunks: Uint8Array[], totalFrames: number, sampleRate: number, channels: number, bitsPerSample: number): Blob {
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const newDataSize = totalFrames * bytesPerFrame;
  const wavHeader = new ArrayBuffer(44);
  const hv = new DataView(wavHeader);

  writeStr(hv, 0, 'RIFF');
  hv.setUint32(4, 36 + newDataSize, true);
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
  hv.setUint32(40, newDataSize, true);

  return new Blob([new Uint8Array(wavHeader), ...chunks], { type: 'audio/wav' });
}

/** Download a byte range from a URL */
async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const resp = await fetch(url, {
    headers: { 'Range': `bytes=${start}-${end - 1}` },
  });
  
  if (resp.status === 206 || resp.ok) {
    return new Uint8Array(await resp.arrayBuffer());
  }
  throw new Error(`Range request failed: ${resp.status}`);
}

/** Check if the server supports Range requests */
async function supportsRange(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
    });
    const acceptRanges = resp.headers.get('accept-ranges');
    return acceptRanges === 'bytes';
  } catch {
    return false;
  }
}

/**
 * Mode "sampled" with Range requests: download MAX_SAMPLES × SAMPLE_SECONDS
 * of audio evenly spread across the file. Returns individual WAV blobs
 * (one per sample) to avoid concatenation artifacts that tank WVMOS/SigMOS scores.
 */
async function buildSampledWavSegments(
  fileUrl: string,
  header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number },
): Promise<Blob[]> {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const totalDuration = totalFrames / sampleRate;

  const segmentFrames = sampleRate * SEGMENT_SECONDS;
  const sampleFrames = sampleRate * SAMPLE_SECONDS;
  const sampleOffsetFrames = sampleRate * 25;

  if (totalDuration <= SAMPLE_SECONDS * MAX_SAMPLES) {
    // Short enough to download entirely as one blob
    console.log(`Audio is ${totalDuration.toFixed(1)}s — downloading full data portion`);
    const data = await fetchRange(fileUrl, dataOffset, dataOffset + dataSize);
    return [buildWav([data], totalFrames, sampleRate, channels, bitsPerSample)];
  }

  const numSegments = Math.ceil(totalFrames / segmentFrames);
  
  // Pick MAX_SAMPLES segments evenly distributed
  let segmentIndices: number[];
  if (numSegments <= MAX_SAMPLES) {
    segmentIndices = Array.from({ length: numSegments }, (_, i) => i);
  } else {
    segmentIndices = Array.from({ length: MAX_SAMPLES }, (_, i) => 
      Math.round(i * (numSegments - 1) / (MAX_SAMPLES - 1))
    );
  }
  
  console.log(`Audio is ${totalDuration.toFixed(1)}s (${numSegments} segments) — downloading ${segmentIndices.length} individual samples: [${segmentIndices.join(', ')}]`);

  const blobs: Blob[] = [];

  for (const seg of segmentIndices) {
    const segStartFrame = seg * segmentFrames;
    const segEndFrame = Math.min(segStartFrame + segmentFrames, totalFrames);
    const segLength = segEndFrame - segStartFrame;

    let extractStart: number;
    const framesToExtract = Math.min(sampleFrames, segLength);

    if (segLength <= sampleFrames) {
      extractStart = segStartFrame;
    } else if (segLength > sampleOffsetFrames + sampleFrames) {
      extractStart = segStartFrame + sampleOffsetFrames;
    } else {
      extractStart = segStartFrame + Math.floor((segLength - framesToExtract) / 2);
    }

    const byteStart = dataOffset + extractStart * bytesPerFrame;
    const byteEnd = byteStart + framesToExtract * bytesPerFrame;
    const safeEnd = Math.min(byteEnd, dataOffset + dataSize);

    const extractedFrames = Math.floor((safeEnd - byteStart) / bytesPerFrame);
    console.log(`  Sample ${segmentIndices.indexOf(seg) + 1}/${segmentIndices.length} (seg ${seg + 1}): ${((safeEnd - byteStart) / 1024).toFixed(0)}KB, ${(extractedFrames / sampleRate).toFixed(1)}s`);
    const chunk = await fetchRange(fileUrl, byteStart, safeEnd);
    // Build an individual WAV per sample — no concatenation artifacts
    blobs.push(buildWav([chunk], extractedFrames, sampleRate, channels, bitsPerSample));
  }

  console.log(`Built ${blobs.length} individual sample WAVs`);
  return blobs;
}

/**
 * Mode "full_segments" with Range requests: download 1-min segments one at a time.
 */
async function* streamSegments(
  fileUrl: string,
  header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number }
): AsyncGenerator<{ blob: Blob; index: number; total: number }> {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const segmentFrames = sampleRate * SEGMENT_SECONDS;
  const numSegments = Math.ceil(totalFrames / segmentFrames);

  console.log(`Splitting ${(totalFrames / sampleRate).toFixed(1)}s audio into ${numSegments} segments of up to ${SEGMENT_SECONDS}s`);

  for (let seg = 0; seg < numSegments; seg++) {
    const startFrame = seg * segmentFrames;
    const endFrame = Math.min(startFrame + segmentFrames, totalFrames);
    const framesInSegment = endFrame - startFrame;

    const byteStart = dataOffset + startFrame * bytesPerFrame;
    const byteEnd = Math.min(dataOffset + endFrame * bytesPerFrame, dataOffset + dataSize);

    console.log(`  Downloading segment ${seg + 1}/${numSegments}: ${((byteEnd - byteStart) / 1024).toFixed(0)}KB`);
    const chunk = await fetchRange(fileUrl, byteStart, byteEnd);
    const blob = buildWav([chunk], framesInSegment, sampleRate, channels, bitsPerSample);

    yield { blob, index: seg, total: numSegments };
  }
}

/** Send a single audio blob to the metrics API and return the result (with retry for sleeping Spaces) */
async function callMetricsApi(audioBlob: Blob, filename: string, apiUrl: string, apiSecret?: string): Promise<Record<string, number | null>> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const formData = new FormData();
    formData.append('file', audioBlob, filename);

    const headers: Record<string, string> = {};
    if (apiSecret) {
      headers['Authorization'] = `Bearer ${apiSecret}`;
    }

    const apiResponse = await fetch(`${apiUrl}/analyze`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (apiResponse.ok) {
      return await apiResponse.json();
    }

    const errText = await apiResponse.text();
    const isHtmlError = errText.trim().startsWith('<!DOCTYPE') || errText.trim().startsWith('<html');

    if (isHtmlError && attempt < maxRetries) {
      const waitSec = (attempt + 1) * 15;
      console.warn(`Metrics API returned HTML (Space may be waking up), retrying in ${waitSec}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      try {
        await fetch(`${apiUrl}/health`);
      } catch (_) { /* ignore */ }
      continue;
    }

    console.error('Metrics API error:', apiResponse.status, errText.substring(0, 200));
    throw new Error(`Metrics API error: ${apiResponse.status}${isHtmlError ? ' (Space may be down or sleeping)' : ''}`);
  }

  throw new Error('Metrics API: max retries exceeded');
}

/** Average numeric metrics across multiple results */
function averageMetrics(results: Record<string, number | null>[]): Record<string, number | null> {
  if (results.length === 0) return {};
  if (results.length === 1) return results[0];

  const keys = Object.keys(results[0]);
  const averaged: Record<string, number | null> = {};

  for (const key of keys) {
    const values = results.map(r => r[key]).filter((v): v is number => v !== null && v !== undefined);
    averaged[key] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  return averaged;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id, file_url, mode = 'sampled', target = 'original' } = await req.json();

    if (!recording_id || !file_url) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id or file_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const METRICS_API_URL = Deno.env.get('METRICS_API_URL');
    const METRICS_API_SECRET = Deno.env.get('METRICS_API_SECRET');
    console.log(`Mode: ${mode}, METRICS_API_URL: "${METRICS_API_URL}"`);

    if (!METRICS_API_URL) {
      return new Response(
        JSON.stringify({ error: 'METRICS_API_URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isMP3 = file_url.toLowerCase().includes('.mp3');
    let metrics: Record<string, number | null>;
    let metricsMode: string;

    if (isMP3) {
      // MP3: must download full file (can't parse without decoding)
      console.log(`MP3 file — downloading full file`);
      const audioResp = await fetch(file_url);
      if (!audioResp.ok) throw new Error(`Failed to download audio: ${audioResp.status}`);
      const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
      console.log(`MP3: ${(audioBytes.length / 1024).toFixed(0)}KB`);
      const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
      metrics = await callMetricsApi(audioBlob, 'audio.mp3', METRICS_API_URL, METRICS_API_SECRET);
      metricsMode = 'full_mp3';
    } else {
      // WAV: use Range requests to avoid loading full file
      const rangeSupported = await supportsRange(file_url);
      console.log(`Range requests supported: ${rangeSupported}`);

      // Download just the header (first 4KB is more than enough)
      let headerBytes: Uint8Array;
      if (rangeSupported) {
        headerBytes = await fetchRange(file_url, 0, 4096);
      } else {
        // Fallback: download full file if Range not supported
        console.warn('Range requests not supported, downloading full file');
        const audioResp = await fetch(file_url);
        if (!audioResp.ok) throw new Error(`Failed to download audio: ${audioResp.status}`);
        const fullBytes = new Uint8Array(await audioResp.arrayBuffer());
        
        // Process in-memory (old behavior) for servers without Range support
        const header = parseWavHeader(fullBytes);
        if (!header) {
          console.warn('Could not parse WAV header, sending full file');
          const audioBlob = new Blob([fullBytes], { type: 'audio/wav' });
          metrics = await callMetricsApi(audioBlob, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
          metricsMode = 'full_unparsed';
        } else {
          // Extract individual samples in-memory (no concatenation)
          const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
          const bytesPerFrame = channels * (bitsPerSample / 8);
          const totalFrames = Math.floor(dataSize / bytesPerFrame);
          const totalDuration = totalFrames / sampleRate;
          const segmentFrames = sampleRate * SEGMENT_SECONDS;
          const sampleFramesCount = sampleRate * SAMPLE_SECONDS;
          const sampleOffsetFrames = sampleRate * 25;

          if (totalDuration <= SAMPLE_SECONDS) {
            // Very short file — send as-is
            const audioBlob = new Blob([fullBytes], { type: 'audio/wav' });
            metrics = await callMetricsApi(audioBlob, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
          } else {
            // Build individual WAV blobs per sample, send each separately
            const numSegments = Math.ceil(totalFrames / segmentFrames);
            const sampleBlobs: Blob[] = [];
            
            for (let seg = 0; seg < numSegments; seg++) {
              const segStartFrame = seg * segmentFrames;
              const segEndFrame = Math.min(segStartFrame + segmentFrames, totalFrames);
              const segLength = segEndFrame - segStartFrame;
              let extractStart: number;
              const framesToExtract = Math.min(sampleFramesCount, segLength);
              if (segLength <= sampleFramesCount) extractStart = segStartFrame;
              else if (segLength > sampleOffsetFrames + sampleFramesCount) extractStart = segStartFrame + sampleOffsetFrames;
              else extractStart = segStartFrame + Math.floor((segLength - framesToExtract) / 2);
              const byteStart = dataOffset + extractStart * bytesPerFrame;
              const byteEnd = Math.min(byteStart + framesToExtract * bytesPerFrame, fullBytes.length);
              const chunk = fullBytes.slice(byteStart, byteEnd);
              const extractedFrames = Math.floor(chunk.length / bytesPerFrame);
              sampleBlobs.push(buildWav([chunk], extractedFrames, sampleRate, channels, bitsPerSample));
            }

            if (sampleBlobs.length === 1) {
              metrics = await callMetricsApi(sampleBlobs[0], 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
            } else {
              const results: Record<string, number | null>[] = [];
              for (let i = 0; i < sampleBlobs.length; i++) {
                const result = await callMetricsApi(sampleBlobs[i], `sample_${i}.wav`, METRICS_API_URL, METRICS_API_SECRET);
                results.push(result);
              }
              metrics = averageMetrics(results);
            }
          }
          metricsMode = `sampled_${SAMPLE_SECONDS}s_per_${SEGMENT_SECONDS}s`;
        }

        // Save and return early for non-Range path
        if (metrics! !== undefined) {
          await saveMetrics(recording_id, metrics!, metricsMode!, target);
          return new Response(
            JSON.stringify({ success: true, recording_id, metrics, mode: metricsMode }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const header = parseWavHeader(headerBytes!);

      if (!header) {
        console.warn('Could not parse WAV header from Range request, downloading full file');
        const audioResp = await fetch(file_url);
        if (!audioResp.ok) throw new Error(`Failed to download audio: ${audioResp.status}`);
        const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
        const audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
        metrics = await callMetricsApi(audioBlob, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
        metricsMode = 'full_unparsed';
      } else if (mode === 'full_segments') {
        // Full segments mode: download one segment at a time via Range requests
        const results: Record<string, number | null>[] = [];
        for await (const { blob, index, total } of streamSegments(file_url, header)) {
          console.log(`Analyzing segment ${index + 1}/${total} (${(blob.size / 1024).toFixed(0)}KB)`);
          const result = await callMetricsApi(blob, `segment_${index}.wav`, METRICS_API_URL, METRICS_API_SECRET);
          results.push(result);
        }
        metrics = averageMetrics(results);
        metricsMode = `full_segments`;
        console.log(`Averaged metrics from ${results.length} segments`);
      } else {
        // Sampled mode (default): download individual samples via Range requests,
        // send each separately to avoid concatenation artifacts (WVMOS/SigMOS sensitive)
        const sampleBlobs = await buildSampledWavSegments(file_url, header);
        
        if (sampleBlobs.length === 1) {
          // Short file or single sample — one call is enough
          console.log(`Sending single sample ${(sampleBlobs[0].size / 1024).toFixed(0)}KB to metrics API`);
          metrics = await callMetricsApi(sampleBlobs[0], 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
        } else {
          // Multiple samples — send each individually and average
          console.log(`Sending ${sampleBlobs.length} individual samples to metrics API`);
          const results: Record<string, number | null>[] = [];
          for (let i = 0; i < sampleBlobs.length; i++) {
            console.log(`  Analyzing sample ${i + 1}/${sampleBlobs.length} (${(sampleBlobs[i].size / 1024).toFixed(0)}KB)`);
            const result = await callMetricsApi(sampleBlobs[i], `sample_${i}.wav`, METRICS_API_URL, METRICS_API_SECRET);
            results.push(result);
          }
          metrics = averageMetrics(results);
          console.log(`Averaged metrics from ${results.length} individual samples`);
        }
        metricsMode = `sampled_${SAMPLE_SECONDS}s_per_${SEGMENT_SECONDS}s`;
      }
    }

    console.log(`Metrics received for recording ${recording_id}:`, JSON.stringify(metrics));

    await saveMetrics(recording_id, metrics, metricsMode, target);

    return new Response(
      JSON.stringify({ success: true, recording_id, metrics, mode: metricsMode }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Metrics estimation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/** Classify quality tier based on metrics thresholds */
function computeQualityTier(metrics: Record<string, number | null>): string {
  const snr = metrics.snr_db ?? null;
  const sigmos = metrics.sigmos_ovrl ?? null;
  const srmr = metrics.srmr ?? null;
  const rms = metrics.rms_dbfs ?? null;

  // PQ (Premium): ALL must pass
  if (snr !== null && snr >= 30 && sigmos !== null && sigmos >= 3.0 && srmr !== null && srmr >= 7.0 && rms !== null && rms >= -24) {
    return 'pq';
  }
  // HQ (High): ALL must pass
  if (snr !== null && snr >= 25 && sigmos !== null && sigmos >= 2.3 && srmr !== null && srmr >= 5.4 && rms !== null && rms >= -26) {
    return 'hq';
  }
  // MQ (Medium): sigmos, srmr, rms must pass
  if (sigmos !== null && sigmos >= 2.0 && srmr !== null && srmr >= 4.0 && rms !== null && rms >= -28) {
    return 'mq';
  }
  return 'lq';
}

async function saveMetrics(recording_id: string, metrics: Record<string, number | null>, metricsMode: string, target: string = 'original') {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: recording } = await supabase
    .from('voice_recordings')
    .select('metadata')
    .eq('id', recording_id)
    .single();

  const existingMeta = (recording?.metadata || {}) as Record<string, unknown>;

  if (target === 'enhanced') {
    // Store enhanced metrics under a separate key AND as top-level enhanced_* fields for UI
    const metadata = {
      ...existingMeta,
      enhanced_snr_db: metrics.snr_db ?? existingMeta.enhanced_snr_db ?? null,
      enhanced_rms_level_db: metrics.rms_dbfs ?? existingMeta.enhanced_rms_level_db ?? null,
      enhanced_metrics: {
        srmr: metrics.srmr ?? null,
        sigmos_disc: metrics.sigmos_disc ?? null,
        sigmos_ovrl: metrics.sigmos_ovrl ?? null,
        sigmos_reverb: metrics.sigmos_reverb ?? null,
        vqscore: metrics.vqscore ?? null,
        wvmos: metrics.wvmos ?? null,
        utmos: metrics.utmos ?? null,
        mic_sr: metrics.mic_sr ?? null,
        file_sr: metrics.file_sr ?? null,
        rms_dbfs: metrics.rms_dbfs ?? null,
        snr_db: metrics.snr_db ?? null,
        metrics_source: 'huggingface-space',
        metrics_estimated_at: new Date().toISOString(),
        metrics_mode: metricsMode,
      },
    };

    await supabase
      .from('voice_recordings')
      .update({ metadata })
      .eq('id', recording_id);
  } else {
    const metadata = {
      ...existingMeta,
      srmr: metrics.srmr ?? null,
      sigmos_disc: metrics.sigmos_disc ?? null,
      sigmos_ovrl: metrics.sigmos_ovrl ?? null,
      sigmos_reverb: metrics.sigmos_reverb ?? null,
      vqscore: metrics.vqscore ?? null,
      wvmos: metrics.wvmos ?? null,
      utmos: metrics.utmos ?? null,
      mic_sr: metrics.mic_sr ?? null,
      file_sr: metrics.file_sr ?? null,
      rms_dbfs: metrics.rms_dbfs ?? null,
      rms_level_db: metrics.rms_dbfs ?? existingMeta.rms_level_db ?? null,
      snr_db: metrics.snr_db ?? null,
      metrics_source: 'huggingface-space',
      metrics_estimated_at: new Date().toISOString(),
      metrics_mode: metricsMode,
    };

    // Also update top-level snr_db column so the UI can read it directly
    const updatePayload: Record<string, unknown> = { metadata };
    if (metrics.snr_db != null) {
      updatePayload.snr_db = metrics.snr_db;
    }

    await supabase
      .from('voice_recordings')
      .update(updatePayload)
      .eq('id', recording_id);
  }

  console.log(`Metrics saved for recording ${recording_id} (mode: ${metricsMode}, target: ${target})`);
}
