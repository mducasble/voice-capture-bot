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

/**
 * Extract 10s samples from each 1-minute segment of the audio.
 * For each minute, we take 10s starting at the 25s mark (middle of the segment).
 * If the audio is shorter than SEGMENT_SECONDS, we take up to SAMPLE_SECONDS from the middle.
 * Returns a new WAV blob with the concatenated samples.
 */
function extractSampledWav(audioBytes: Uint8Array, header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number }): Blob {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const totalDuration = totalFrames / sampleRate;

  const segmentFrames = sampleRate * SEGMENT_SECONDS;
  const sampleFrames = sampleRate * SAMPLE_SECONDS;
  // Start sampling at 25s into each segment (centered in the minute)
  const sampleOffsetFrames = sampleRate * 25;

  const extractedChunks: Uint8Array[] = [];
  let totalExtractedFrames = 0;

  if (totalDuration <= SAMPLE_SECONDS) {
    // Audio is shorter than sample size — send it all
    const chunk = audioBytes.slice(dataOffset, dataOffset + dataSize);
    extractedChunks.push(chunk);
    totalExtractedFrames = totalFrames;
    console.log(`Audio is ${totalDuration.toFixed(1)}s — sending full audio`);
  } else {
    const numSegments = Math.ceil(totalFrames / segmentFrames);
    console.log(`Audio is ${totalDuration.toFixed(1)}s — extracting ${SAMPLE_SECONDS}s from each of ${numSegments} segments`);

    for (let seg = 0; seg < numSegments; seg++) {
      const segStartFrame = seg * segmentFrames;
      const segEndFrame = Math.min(segStartFrame + segmentFrames, totalFrames);
      const segLength = segEndFrame - segStartFrame;

      // Determine sample start within this segment
      let extractStart: number;
      const framesToExtract = Math.min(sampleFrames, segLength);

      if (segLength <= sampleFrames) {
        // Segment is shorter than sample size — take it all
        extractStart = segStartFrame;
      } else if (segLength > sampleOffsetFrames + sampleFrames) {
        // Normal case — sample from 25s mark
        extractStart = segStartFrame + sampleOffsetFrames;
      } else {
        // Segment too short for 25s offset — center the sample
        extractStart = segStartFrame + Math.floor((segLength - framesToExtract) / 2);
      }

      const byteStart = dataOffset + extractStart * bytesPerFrame;
      const byteEnd = byteStart + framesToExtract * bytesPerFrame;
      const safeEnd = Math.min(byteEnd, audioBytes.length);

      extractedChunks.push(audioBytes.slice(byteStart, safeEnd));
      totalExtractedFrames += Math.floor((safeEnd - byteStart) / bytesPerFrame);
    }
  }

  // Build new WAV with extracted samples
  const newDataSize = totalExtractedFrames * bytesPerFrame;
  const wavHeader = new ArrayBuffer(44);
  const hv = new DataView(wavHeader);

  // RIFF header
  writeStr(hv, 0, 'RIFF');
  hv.setUint32(4, 36 + newDataSize, true);
  writeStr(hv, 8, 'WAVE');
  // fmt chunk
  writeStr(hv, 12, 'fmt ');
  hv.setUint32(16, 16, true);
  hv.setUint16(20, 1, true); // PCM
  hv.setUint16(22, channels, true);
  hv.setUint32(24, sampleRate, true);
  hv.setUint32(28, sampleRate * bytesPerFrame, true);
  hv.setUint16(32, bytesPerFrame, true);
  hv.setUint16(34, bitsPerSample, true);
  // data chunk
  writeStr(hv, 36, 'data');
  hv.setUint32(40, newDataSize, true);

  const parts = [new Uint8Array(wavHeader), ...extractedChunks];
  const totalSize = 44 + parts.slice(1).reduce((s, c) => s + c.length, 0);
  console.log(`Sampled WAV: ${totalExtractedFrames} frames, ${(totalExtractedFrames / sampleRate).toFixed(1)}s, ${(totalSize / 1024).toFixed(0)}KB (original ${(audioBytes.length / 1024).toFixed(0)}KB)`);

  return new Blob(parts, { type: 'audio/wav' });
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id, file_url, snr_db, rms_dbfs } = await req.json();

    if (!recording_id || !file_url) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id or file_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const METRICS_API_URL = Deno.env.get('METRICS_API_URL');
    const METRICS_API_SECRET = Deno.env.get('METRICS_API_SECRET');
    console.log(`METRICS_API_URL value: "${METRICS_API_URL}"`);
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

    // For WAV files, extract 10s/min samples; for MP3, send as-is (already compressed)
    let audioBlob: Blob;
    let filename: string;

    if (!isMP3) {
      const header = parseWavHeader(audioBytes);
      if (header) {
        audioBlob = extractSampledWav(audioBytes, header);
        filename = 'audio.wav';
        console.log(`WAV sampling complete for recording ${recording_id}`);
      } else {
        console.warn('Could not parse WAV header, sending full file');
        audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
        filename = 'audio.wav';
      }
    } else {
      // MP3 files are already small; send as-is
      audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
      filename = 'audio.mp3';
    }

    // Send to external metrics API
    console.log(`Sending ${(audioBlob.size / 1024).toFixed(0)}KB to metrics API for recording ${recording_id}`);
    const formData = new FormData();
    formData.append('file', audioBlob, filename);

    const headers: Record<string, string> = {};
    if (METRICS_API_SECRET) {
      headers['Authorization'] = `Bearer ${METRICS_API_SECRET}`;
    }

    const apiResponse = await fetch(`${METRICS_API_URL}/analyze`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('Metrics API error:', apiResponse.status, errText);
      throw new Error(`Metrics API error: ${apiResponse.status}`);
    }

    const metrics = await apiResponse.json();
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
      metrics_sampling: `${SAMPLE_SECONDS}s per ${SEGMENT_SECONDS}s`,
    };

    await supabase
      .from('voice_recordings')
      .update({ metadata })
      .eq('id', recording_id);

    console.log(`Metrics saved for recording ${recording_id}`);

    return new Response(
      JSON.stringify({ success: true, recording_id, metrics }),
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
