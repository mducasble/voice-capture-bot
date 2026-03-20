import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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
      const rawMetrics = await apiResponse.json() as Record<string, unknown>;
      return normalizeMetrics(rawMetrics);
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

function averageNumbers(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
}

function normalizeMetricValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMetrics(metrics: Record<string, unknown>): Record<string, number | null> {
  const normalized: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(metrics ?? {})) {
    normalized[key] = normalizeMetricValue(value);
  }
  return normalized;
}

type SpeechRegion = {
  start: number;
  end: number;
  energy: number;
};

function detectSpeechRegions(samples: Int16Array, sampleRate: number): SpeechRegion[] {
  if (samples.length === 0) return [];

  const windowSize = Math.floor(sampleRate * 0.02);
  const hopSize = Math.floor(windowSize / 2);
  const numWindows = Math.floor((samples.length - windowSize) / hopSize) + 1;

  if (numWindows < 3) return [];

  const energies: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    let energy = 0;
    for (let i = 0; i < windowSize && start + i < samples.length; i++) {
      const sample = samples[start + i] / 32768.0;
      energy += sample * sample;
    }
    energies.push(energy / windowSize);
  }

  const sortedEnergies = [...energies].sort((a, b) => a - b);
  const noiseFloorIdx = Math.floor(sortedEnergies.length * 0.2);
  let noiseFloorEnergy = 0;
  for (let i = 0; i < noiseFloorIdx; i++) {
    noiseFloorEnergy += sortedEnergies[i];
  }
  noiseFloorEnergy = noiseFloorIdx > 0 ? noiseFloorEnergy / noiseFloorIdx : 0.0001;

  const threshold = Math.max(noiseFloorEnergy * 3, 0.0001);
  const regions: SpeechRegion[] = [];
  let inSpeech = false;
  let regionStart = 0;
  let regionEnergy = 0;
  let regionCount = 0;
  const minSpeechWindows = 5;
  const hangoverWindows = 10;
  let hangoverCounter = 0;

  for (let w = 0; w < numWindows; w++) {
    const isAboveThreshold = energies[w] > threshold;

    if (!inSpeech && isAboveThreshold) {
      inSpeech = true;
      regionStart = w * hopSize;
      regionEnergy = energies[w];
      regionCount = 1;
      hangoverCounter = hangoverWindows;
    } else if (inSpeech) {
      if (isAboveThreshold) {
        regionEnergy += energies[w];
        regionCount++;
        hangoverCounter = hangoverWindows;
      } else {
        hangoverCounter--;
        if (hangoverCounter <= 0) {
          if (regionCount >= minSpeechWindows) {
            const regionEnd = Math.min(w * hopSize + windowSize, samples.length);
            regions.push({
              start: regionStart,
              end: regionEnd,
              energy: regionEnergy / regionCount,
            });
          }
          inSpeech = false;
        }
      }
    }
  }

  if (inSpeech && regionCount >= minSpeechWindows) {
    regions.push({
      start: regionStart,
      end: samples.length,
      energy: regionEnergy / regionCount,
    });
  }

  return regions;
}

function calculateSNR(samples: Int16Array, sampleRate: number = 16000): number {
  if (samples.length === 0) return 0;

  const speechRegions = detectSpeechRegions(samples, sampleRate);
  if (speechRegions.length === 0) {
    return 5.0;
  }

  const speechSamples: number[] = [];
  for (const region of speechRegions) {
    for (let i = region.start; i < region.end; i++) {
      speechSamples.push(samples[i] / 32768.0);
    }
  }

  if (speechSamples.length < sampleRate * 0.5) {
    return 8.0;
  }

  let signalSum = 0;
  for (const sample of speechSamples) {
    signalSum += sample * sample;
  }
  const signalRMS = Math.sqrt(signalSum / speechSamples.length);

  if (signalRMS < 0.001) {
    return 5.0;
  }

  const silenceSamples: number[] = [];
  let lastEnd = 0;
  for (const region of speechRegions) {
    for (let i = lastEnd; i < region.start; i++) {
      silenceSamples.push(samples[i] / 32768.0);
    }
    lastEnd = region.end;
  }
  for (let i = lastEnd; i < samples.length; i++) {
    silenceSamples.push(samples[i] / 32768.0);
  }

  let noiseFloor: number;
  if (silenceSamples.length >= sampleRate * 0.2) {
    let noiseSum = 0;
    for (const sample of silenceSamples) {
      noiseSum += sample * sample;
    }
    noiseFloor = Math.sqrt(noiseSum / silenceSamples.length);
  } else {
    const sortedAbs = speechSamples.map(Math.abs).sort((a, b) => a - b);
    const bottomCount = Math.max(1, Math.floor(sortedAbs.length * 0.1));
    let noiseSum = 0;
    for (let i = 0; i < bottomCount; i++) {
      noiseSum += sortedAbs[i] * sortedAbs[i];
    }
    noiseFloor = Math.sqrt(noiseSum / bottomCount);
  }

  if (noiseFloor < 0.0001) {
    return 60.0;
  }

  const snr = 20 * Math.log10(signalRMS / noiseFloor);
  if (!isFinite(snr) || snr > 100) return 60.0;
  if (snr < 0) return 5.0;

  return Math.round(snr * 10) / 10;
}

function readPcmSampleAsFloat(view: DataView, offset: number, bitsPerSample: number): number | null {
  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32768;
    case 24: {
      const b0 = view.getUint8(offset);
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getUint8(offset + 2);
      let value = b0 | (b1 << 8) | (b2 << 16);
      if (value & 0x800000) {
        value |= ~0xffffff;
      }
      return value / 8388608;
    }
    case 32:
      return view.getInt32(offset, true) / 2147483648;
    default:
      return null;
  }
}

function extractMonoSamplesFromWav(bytes: Uint8Array, header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number }): Int16Array | null {
  const bytesPerSample = header.bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) return null;

  const bytesPerFrame = header.channels * bytesPerSample;
  const frameCount = Math.floor(header.dataSize / bytesPerFrame);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const monoSamples = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const frameOffset = header.dataOffset + frame * bytesPerFrame;
    let sum = 0;
    let validChannels = 0;

    for (let channel = 0; channel < header.channels; channel++) {
      const sampleOffset = frameOffset + channel * bytesPerSample;
      if (sampleOffset + bytesPerSample > bytes.byteOffset + bytes.byteLength) {
        continue;
      }
      const sample = readPcmSampleAsFloat(view, sampleOffset, header.bitsPerSample);
      if (sample === null) continue;
      sum += sample;
      validChannels++;
    }

    if (validChannels === 0) {
      monoSamples[frame] = 0;
      continue;
    }

    const averaged = sum / validChannels;
    monoSamples[frame] = Math.max(-32768, Math.min(32767, Math.round(averaged * 32767)));
  }

  return monoSamples;
}

function computeSnrFromWavBytes(bytes: Uint8Array): number | null {
  const header = parseWavHeader(bytes);
  if (!header) return null;

  const monoSamples = extractMonoSamplesFromWav(bytes, header);
  if (!monoSamples || monoSamples.length === 0) return null;

  return calculateSNR(monoSamples, header.sampleRate);
}

async function computeAverageSnrFromBlobs(blobs: Blob[]): Promise<number | null> {
  const snrValues: Array<number | null> = [];
  for (const blob of blobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    snrValues.push(computeSnrFromWavBytes(bytes));
  }
  return averageNumbers(snrValues);
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
    let fallbackSnr: number | null = null;

    if (isMP3) {
      console.log('MP3 file — downloading full file');
      const audioResp = await fetch(file_url);
      if (!audioResp.ok) throw new Error(`Failed to download audio: ${audioResp.status}`);
      const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
      console.log(`MP3: ${(audioBytes.length / 1024).toFixed(0)}KB`);
      const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
      metrics = await callMetricsApi(audioBlob, 'audio.mp3', METRICS_API_URL, METRICS_API_SECRET);
      metricsMode = 'full_mp3';
    } else {
      const rangeSupported = await supportsRange(file_url);
      console.log(`Range requests supported: ${rangeSupported}`);

      let headerBytes: Uint8Array;
      if (rangeSupported) {
        headerBytes = await fetchRange(file_url, 0, 4096);
      } else {
        console.warn('Range requests not supported, downloading full file');
        const audioResp = await fetch(file_url);
        if (!audioResp.ok) throw new Error(`Failed to download audio: ${audioResp.status}`);
        const fullBytes = new Uint8Array(await audioResp.arrayBuffer());

        const header = parseWavHeader(fullBytes);
        if (!header) {
          console.warn('Could not parse WAV header, sending full file');
          const audioBlob = new Blob([fullBytes], { type: 'audio/wav' });
          metrics = await callMetricsApi(audioBlob, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
          metricsMode = 'full_unparsed';
        } else {
          const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
          const bytesPerFrame = channels * (bitsPerSample / 8);
          const totalFrames = Math.floor(dataSize / bytesPerFrame);
          const totalDuration = totalFrames / sampleRate;
          const segmentFrames = sampleRate * SEGMENT_SECONDS;
          const sampleFramesCount = sampleRate * SAMPLE_SECONDS;
          const sampleOffsetFrames = sampleRate * 25;

          if (totalDuration <= SAMPLE_SECONDS) {
            const audioBlob = new Blob([fullBytes], { type: 'audio/wav' });
            metrics = await callMetricsApi(audioBlob, 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
            fallbackSnr = computeSnrFromWavBytes(fullBytes);
          } else {
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

            fallbackSnr = await computeAverageSnrFromBlobs(sampleBlobs);

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

        if (metrics !== undefined) {
          if (metrics.snr_db == null && fallbackSnr != null) {
            metrics.snr_db = fallbackSnr;
            console.log(`Fallback SNR applied for recording ${recording_id}: ${fallbackSnr}dB`);
          }

          await saveMetrics(recording_id, metrics, metricsMode, target);
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
        fallbackSnr = computeSnrFromWavBytes(audioBytes);
        metricsMode = 'full_unparsed';
      } else if (mode === 'full_segments') {
        const results: Record<string, number | null>[] = [];
        const localSnrValues: number[] = [];

        for await (const { blob, index, total } of streamSegments(file_url, header)) {
          console.log(`Analyzing segment ${index + 1}/${total} (${(blob.size / 1024).toFixed(0)}KB)`);
          const result = await callMetricsApi(blob, `segment_${index}.wav`, METRICS_API_URL, METRICS_API_SECRET);
          results.push(result);

          const localSnr = await computeAverageSnrFromBlobs([blob]);
          if (localSnr != null) {
            localSnrValues.push(localSnr);
          }
        }

        metrics = averageMetrics(results);
        fallbackSnr = averageNumbers(localSnrValues);
        metricsMode = 'full_segments';
        console.log(`Averaged metrics from ${results.length} segments`);
      } else {
        const sampleBlobs = await buildSampledWavSegments(file_url, header);
        fallbackSnr = await computeAverageSnrFromBlobs(sampleBlobs);

        if (sampleBlobs.length === 1) {
          console.log(`Sending single sample ${(sampleBlobs[0].size / 1024).toFixed(0)}KB to metrics API`);
          metrics = await callMetricsApi(sampleBlobs[0], 'audio.wav', METRICS_API_URL, METRICS_API_SECRET);
        } else {
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

    if (metrics.snr_db == null && fallbackSnr != null) {
      metrics.snr_db = fallbackSnr;
      console.log(`Fallback SNR applied for recording ${recording_id}: ${fallbackSnr}dB`);
    }

    console.log(`Metrics received for recording ${recording_id}:`, JSON.stringify(metrics));

    await saveMetrics(recording_id, metrics, metricsMode, target);

    const serviceName = (METRICS_API_URL || '').includes('hf.space') || (METRICS_API_URL || '').includes('huggingface') ? 'HuggingFace' : 'VPS Metrics';
    return new Response(
      JSON.stringify({ success: true, recording_id, metrics, mode: metricsMode, service: serviceName }),
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

  if (snr !== null && snr >= 30 && sigmos !== null && sigmos >= 3.0 && srmr !== null && srmr >= 7.0 && rms !== null && rms >= -24) {
    return 'pq';
  }
  if (snr !== null && snr >= 25 && sigmos !== null && sigmos >= 2.3 && srmr !== null && srmr >= 5.4 && rms !== null && rms >= -26) {
    return 'hq';
  }
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
  const existingQualityMetrics = typeof existingMeta.quality_metrics === 'object' && existingMeta.quality_metrics !== null
    ? existingMeta.quality_metrics as Record<string, unknown>
    : {};
  const existingEnhancedMetrics = typeof existingMeta.enhanced_metrics === 'object' && existingMeta.enhanced_metrics !== null
    ? existingMeta.enhanced_metrics as Record<string, unknown>
    : {};

  const resolvedSnrDb = normalizeMetricValue(metrics.snr_db) ?? normalizeMetricValue(existingMeta.snr_db) ?? normalizeMetricValue(existingQualityMetrics.snr_db);
  const resolvedRmsDbfs = normalizeMetricValue(metrics.rms_dbfs) ?? normalizeMetricValue(existingMeta.rms_dbfs) ?? normalizeMetricValue(existingMeta.rms_level_db) ?? normalizeMetricValue(existingQualityMetrics.rms_dbfs);
  const resolvedEnhancedSnrDb = normalizeMetricValue(metrics.snr_db) ?? normalizeMetricValue(existingMeta.enhanced_snr_db) ?? normalizeMetricValue(existingEnhancedMetrics.snr_db);
  const resolvedEnhancedRmsDbfs = normalizeMetricValue(metrics.rms_dbfs) ?? normalizeMetricValue(existingMeta.enhanced_rms_level_db) ?? normalizeMetricValue(existingEnhancedMetrics.rms_dbfs);

  if (target === 'enhanced') {
    const enhancedMetrics = {
      ...metrics,
      snr_db: resolvedEnhancedSnrDb,
      rms_dbfs: resolvedEnhancedRmsDbfs,
    };
    const enhancedTier = computeQualityTier(enhancedMetrics);
    const metadata = {
      ...existingMeta,
      enhanced_snr_db: resolvedEnhancedSnrDb,
      enhanced_rms_level_db: resolvedEnhancedRmsDbfs,
      enhanced_quality_tier: enhancedTier,
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
        rms_dbfs: resolvedEnhancedRmsDbfs,
        snr_db: resolvedEnhancedSnrDb,
        quality_tier: enhancedTier,
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
    const normalizedMetrics = {
      ...metrics,
      snr_db: resolvedSnrDb,
      rms_dbfs: resolvedRmsDbfs,
    };
    const qualityTier = computeQualityTier(normalizedMetrics);
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
      rms_dbfs: resolvedRmsDbfs,
      rms_level_db: resolvedRmsDbfs,
      snr_db: resolvedSnrDb,
      quality_tier: qualityTier,
      metrics_source: 'huggingface-space',
      metrics_estimated_at: new Date().toISOString(),
      metrics_mode: metricsMode,
    };

    await supabase
      .from('voice_recordings')
      .update({
        metadata,
        snr_db: resolvedSnrDb,
      })
      .eq('id', recording_id);
  }

  console.log(`Metrics saved for recording ${recording_id} (mode: ${metricsMode}, target: ${target})`);
}
