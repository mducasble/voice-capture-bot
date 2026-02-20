import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sampling config: extract SAMPLE_SECONDS from each SEGMENT_SECONDS of audio
const SEGMENT_SECONDS = 60;
const SAMPLE_SECONDS = 10;

// Parse WAV header
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

/**
 * Mode "sampled": Extract 10s samples from each 1-minute segment.
 * Returns a single WAV blob with concatenated samples.
 */
function extractSampledWav(audioBytes: Uint8Array, header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number }): Blob {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const totalDuration = totalFrames / sampleRate;

  const segmentFrames = sampleRate * SEGMENT_SECONDS;
  const sampleFrames = sampleRate * SAMPLE_SECONDS;
  const sampleOffsetFrames = sampleRate * 25;

  const extractedChunks: Uint8Array[] = [];
  let totalExtractedFrames = 0;

  if (totalDuration <= SAMPLE_SECONDS) {
    extractedChunks.push(audioBytes.slice(dataOffset, dataOffset + dataSize));
    totalExtractedFrames = totalFrames;
    console.log(`Audio is ${totalDuration.toFixed(1)}s — sending full audio`);
  } else {
    const numSegments = Math.ceil(totalFrames / segmentFrames);
    console.log(`Audio is ${totalDuration.toFixed(1)}s — extracting ${SAMPLE_SECONDS}s from each of ${numSegments} segments`);

    for (let seg = 0; seg < numSegments; seg++) {
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
      const safeEnd = Math.min(byteEnd, audioBytes.length);

      extractedChunks.push(audioBytes.slice(byteStart, safeEnd));
      totalExtractedFrames += Math.floor((safeEnd - byteStart) / bytesPerFrame);
    }
  }

  const wav = buildWav(extractedChunks, totalExtractedFrames, sampleRate, channels, bitsPerSample);
  console.log(`Sampled WAV: ${totalExtractedFrames} frames, ${(totalExtractedFrames / sampleRate).toFixed(1)}s, ${(wav.size / 1024).toFixed(0)}KB`);
  return wav;
}

/**
 * Mode "full_segments": Split audio into 1-minute WAV segments.
 * Returns an array of WAV blobs.
 */
function splitIntoSegments(audioBytes: Uint8Array, header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number }): Blob[] {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const segmentFrames = sampleRate * SEGMENT_SECONDS;
  const numSegments = Math.ceil(totalFrames / segmentFrames);

  console.log(`Splitting ${(totalFrames / sampleRate).toFixed(1)}s audio into ${numSegments} segments of up to ${SEGMENT_SECONDS}s`);

  const segments: Blob[] = [];
  for (let seg = 0; seg < numSegments; seg++) {
    const startFrame = seg * segmentFrames;
    const endFrame = Math.min(startFrame + segmentFrames, totalFrames);
    const framesInSegment = endFrame - startFrame;

    const byteStart = dataOffset + startFrame * bytesPerFrame;
    const byteEnd = Math.min(dataOffset + endFrame * bytesPerFrame, audioBytes.length);
    const chunk = audioBytes.slice(byteStart, byteEnd);

    segments.push(buildWav([chunk], framesInSegment, sampleRate, channels, bitsPerSample));
  }

  return segments;
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
      // Ping health endpoint to wake up the Space
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
    const { recording_id, file_url, mode = 'sampled' } = await req.json();

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

    // Download audio file
    console.log(`Downloading audio for recording ${recording_id}`);
    const audioResp = await fetch(file_url);
    if (!audioResp.ok) {
      throw new Error(`Failed to download audio: ${audioResp.status}`);
    }

    const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
    const isMP3 = file_url.toLowerCase().includes('.mp3');

    let metrics: Record<string, number | null>;
    let metricsMode: string;

    if (isMP3) {
      // MP3: send as-is regardless of mode
      console.log(`MP3 file — sending full ${(audioBytes.length / 1024).toFixed(0)}KB`);
      const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
      metrics = await callMetricsApi(audioBlob, 'audio.mp3', METRICS_API_URL, METRICS_API_SECRET);
      metricsMode = 'full_mp3';
    } else {
      const header = parseWavHeader(audioBytes);

      if (!header) {
        console.warn('Could not parse WAV header, sending full file');
        const audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
        metrics = await callMetricsApi(audioBlob, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
        metricsMode = 'full_unparsed';
      } else if (mode === 'full_segments') {
        // Full segments mode: split into 1-min segments, analyze each, average results
        const segments = splitIntoSegments(audioBytes, header);
        console.log(`Sending ${segments.length} segments to metrics API for recording ${recording_id}`);

        const results: Record<string, number | null>[] = [];
        for (let i = 0; i < segments.length; i++) {
          console.log(`Analyzing segment ${i + 1}/${segments.length} (${(segments[i].size / 1024).toFixed(0)}KB)`);
          const result = await callMetricsApi(segments[i], `segment_${i}.wav`, METRICS_API_URL, METRICS_API_SECRET);
          results.push(result);
        }

        metrics = averageMetrics(results);
        metricsMode = `full_segments_${segments.length}x${SEGMENT_SECONDS}s`;
        console.log(`Averaged metrics from ${results.length} segments`);
      } else {
        // Sampled mode (default): 10s per minute
        const sampledWav = extractSampledWav(audioBytes, header);
        console.log(`Sending sampled ${(sampledWav.size / 1024).toFixed(0)}KB to metrics API`);
        metrics = await callMetricsApi(sampledWav, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
        metricsMode = `sampled_${SAMPLE_SECONDS}s_per_${SEGMENT_SECONDS}s`;
      }
    }

    console.log(`Metrics received for recording ${recording_id}:`, JSON.stringify(metrics));

    // Update recording metadata
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: recording } = await supabase
      .from('voice_recordings')
      .select('metadata')
      .eq('id', recording_id)
      .single();

    const metadata = {
      ...(recording?.metadata || {}),
      srmr: metrics.srmr ?? null,
      sigmos_disc: metrics.sigmos_disc ?? null,
      sigmos_ovrl: metrics.sigmos_ovrl ?? null,
      sigmos_reverb: metrics.sigmos_reverb ?? null,
      vqscore: metrics.vqscore ?? null,
      wvmos: metrics.wvmos ?? null,
      utmos: metrics.utmos ?? null,
      mic_sr: metrics.mic_sr ?? null,
      file_sr: metrics.file_sr ?? null,
      metrics_source: 'huggingface-space',
      metrics_estimated_at: new Date().toISOString(),
      metrics_mode: metricsMode,
    };

    await supabase
      .from('voice_recordings')
      .update({ metadata })
      .eq('id', recording_id);

    console.log(`Metrics saved for recording ${recording_id} (mode: ${metricsMode})`);

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
