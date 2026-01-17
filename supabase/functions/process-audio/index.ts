import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const TARGET_SAMPLE_RATE = 16000;
// Use small chunks so we never need to persist partial samples across invocations.
// 30s at 16kHz mono 16-bit ~= 960KB (well under the 4MB transcription cap).
const CHUNK_DURATION_SECONDS = 30;
const SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE * CHUNK_DURATION_SECONDS;
const MAX_PROCESSING_TIME_MS = 8000; // Stop processing after 8 seconds to avoid CPU timeout

// Parse WAV header to get audio info
function parseWavHeader(headerBytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number } | null {
  if (headerBytes.length < 44) return null;
  
  const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  
  const riff = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);
  if (riff !== 'RIFF') return null;
  
  const wave = String.fromCharCode(headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]);
  if (wave !== 'WAVE') return null;
  
  let offset = 12;
  let sampleRate = 48000;
  let channels = 2;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;
  
  while (offset < Math.min(headerBytes.length - 8, 1000)) {
    const chunkId = String.fromCharCode(
      headerBytes[offset], headerBytes[offset + 1],
      headerBytes[offset + 2], headerBytes[offset + 3]
    );
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

// Calculate SNR from audio samples
function calculateSNR(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  
  const floatSamples = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    floatSamples[i] = samples[i] / 32768.0;
  }
  
  let sum = 0;
  for (let i = 0; i < floatSamples.length; i++) {
    sum += floatSamples[i] * floatSamples[i];
  }
  const signalRMS = Math.sqrt(sum / floatSamples.length);
  
  const sorted = Array.from(floatSamples).map(Math.abs).sort((a, b) => a - b);
  const bottomCount = Math.max(1, Math.floor(sorted.length * 0.1));
  let noiseSum = 0;
  for (let i = 0; i < bottomCount; i++) {
    noiseSum += sorted[i] * sorted[i];
  }
  const noiseFloor = Math.sqrt(noiseSum / bottomCount) || 0.0001;
  
  return Math.round(20 * Math.log10(signalRMS / noiseFloor) * 10) / 10;
}

// Create WAV chunk from samples
function createWavChunk(samples: Int16Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  // RIFF header
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  
  // fmt subchunk
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  
  // data subchunk
  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  
  // Write samples
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(headerSize + i * 2, samples[i], true);
  }
  
  return bytes;
}

interface ProcessingState {
  recording_id: string;
  audio_url: string;
  timestamp: string;
  header: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    dataOffset: number;
    dataSize: number;
  };
  bytesProcessed: number;
  srcIdx: number;
  outputSampleIdx: number;
  chunkIndex: number;
  uploadedChunks: { url: string; index: number }[];
  snrDb: number | null;
  snrSamples: number[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    
    // Check if this is a continuation or new processing
    let state: ProcessingState;
    const startTime = Date.now();
    
    if (body.state) {
      // Continuation from previous invocation
      state = body.state;
      console.log(`Resuming processing for ${state.recording_id} at chunk ${state.chunkIndex}`);
    } else {
      // New processing request
      const { recording_id, audio_url } = body;

      if (!recording_id || !audio_url) {
        return new Response(
          JSON.stringify({ error: 'Missing recording_id or audio_url' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Starting new processing for recording ${recording_id}`);

      // Update status to processing
      await supabase.from('voice_recordings').update({ status: 'processing' }).eq('id', recording_id);

      // Fetch just the header first
      const headerResponse = await fetch(audio_url, {
        headers: { 'Range': 'bytes=0-1023' }
      });
      
      if (!headerResponse.ok) {
        throw new Error(`Failed to fetch audio header: ${headerResponse.status}`);
      }

      const headerBytes = new Uint8Array(await headerResponse.arrayBuffer());
      const header = parseWavHeader(headerBytes);
      
      if (!header) {
        throw new Error('Invalid WAV file');
      }

      console.log(`Audio: ${header.sampleRate}Hz, ${header.channels}ch, ${header.bitsPerSample}bit, data at ${header.dataOffset}, size ${header.dataSize}`);

      state = {
        recording_id,
        audio_url,
        timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
        header,
        bytesProcessed: 0,
        srcIdx: 0,
        outputSampleIdx: 0,
        chunkIndex: 0,
        uploadedChunks: [],
        snrDb: null,
        snrSamples: []
      };
    }

    const { header } = state;
    const ratio = header.sampleRate / TARGET_SAMPLE_RATE;
    const bytesPerFrame = header.channels * (header.bitsPerSample / 8);
    const snrSampleTarget = TARGET_SAMPLE_RATE * 5; // 5 seconds for SNR

    // Calculate how much data to fetch this iteration
    // Fetch ~30 seconds of source audio at a time
    const bytesPerSecondSource = header.sampleRate * bytesPerFrame;
    const bytesToFetch = bytesPerSecondSource * 30;
    
    const rangeStart = header.dataOffset + state.bytesProcessed;
    const rangeEnd = Math.min(
      rangeStart + bytesToFetch - 1,
      header.dataOffset + header.dataSize - 1
    );

    if (rangeStart > header.dataOffset + header.dataSize) {
      // All data processed, finalize
      return await finalizeProcessing(supabase, state);
    }

    console.log(`Fetching bytes ${rangeStart}-${rangeEnd}`);
    
    const audioResponse = await fetch(state.audio_url, {
      headers: { 'Range': `bytes=${rangeStart}-${rangeEnd}` }
    });

    if (!audioResponse.ok && audioResponse.status !== 206) {
      throw new Error(`Failed to fetch audio chunk: ${audioResponse.status}`);
    }

    const audioData = new Uint8Array(await audioResponse.arrayBuffer());
    console.log(`Fetched ${audioData.length} bytes`);

    // Process audio data
    const view = new DataView(audioData.buffer, audioData.byteOffset, audioData.byteLength);
    let frameOffset = 0;
    let chunkSamples: number[] = [];

    while (frameOffset + bytesPerFrame <= audioData.length) {
      // Check if we're running out of time
      if (Date.now() - startTime > MAX_PROCESSING_TIME_MS) {
        console.log(`Time limit approaching at chunk ${state.chunkIndex}. Uploading partial audio and continuing...`);

        // Upload partial samples so we don't lose progress between invocations
        if (chunkSamples.length > 0) {
          await uploadChunk(supabase, state, new Int16Array(chunkSamples));
          chunkSamples = [];
        }

        state.bytesProcessed += frameOffset;

        // Schedule continuation
        await scheduleContinuation(supabase, state);

        return new Response(
          JSON.stringify({
            status: 'processing',
            chunks_completed: state.uploadedChunks.length,
            message: 'Continuing in next invocation'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const targetOutputIdx = Math.floor(state.srcIdx / ratio);

      if (targetOutputIdx > state.outputSampleIdx) {
        // Mix channels to mono
        let sample = 0;
        for (let ch = 0; ch < header.channels; ch++) {
          sample += view.getInt16(frameOffset + ch * 2, true);
        }
        const monoSample = Math.round(sample / header.channels);

        chunkSamples.push(monoSample);
        state.outputSampleIdx++;

        // Collect SNR samples
        if (state.snrSamples.length < snrSampleTarget) {
          state.snrSamples.push(monoSample);
        }

        // Check if chunk is complete
        if (chunkSamples.length >= SAMPLES_PER_CHUNK) {
          await uploadChunk(supabase, state, new Int16Array(chunkSamples));
          chunkSamples = [];
        }
      }

      state.srcIdx++;
      frameOffset += bytesPerFrame;
    }

    // Update bytes processed
    state.bytesProcessed += frameOffset;

    // Upload any partial chunk at the end of this invocation (avoids losing samples)
    if (chunkSamples.length > 0) {
      await uploadChunk(supabase, state, new Int16Array(chunkSamples));
      chunkSamples = [];
    }

    // Check if we've processed all data
    const isComplete = state.bytesProcessed >= header.dataSize;

    if (isComplete) {
      return await finalizeProcessing(supabase, state);
    }

    // Need to continue processing
    await scheduleContinuation(supabase, state);

    return new Response(
      JSON.stringify({
        status: 'processing',
        chunks_completed: state.uploadedChunks.length,
        bytes_processed: state.bytesProcessed,
        total_bytes: header.dataSize,
        progress: Math.round(state.bytesProcessed / header.dataSize * 100)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing audio:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Failed to process audio', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// deno-lint-ignore no-explicit-any
async function uploadChunk(
  supabase: any,
  state: ProcessingState,
  samples: Int16Array
) {
  console.log(`Encoding chunk ${state.chunkIndex} with ${samples.length} samples`);
  
  const wavData = createWavChunk(samples, TARGET_SAMPLE_RATE);
  console.log(`Chunk ${state.chunkIndex}: ${samples.length} samples -> ${(wavData.length / 1024).toFixed(1)} KB WAV`);
  
  const chunkPath = `chunks/${state.recording_id}_${state.timestamp}_chunk${String(state.chunkIndex).padStart(3, '0')}.wav`;
  
  const { error: uploadError } = await supabase.storage
    .from('voice-recordings')
    .upload(chunkPath, wavData, {
      contentType: 'audio/wav',
      upsert: true
    });
  
  if (uploadError) {
    console.error(`Failed to upload chunk ${state.chunkIndex}:`, uploadError);
    throw uploadError;
  }
  
  const { data: { publicUrl } } = supabase.storage
    .from('voice-recordings')
    .getPublicUrl(chunkPath);
  
  state.uploadedChunks.push({ url: publicUrl, index: state.chunkIndex });
  console.log(`Uploaded chunk ${state.chunkIndex}: ${publicUrl}`);
  
  state.chunkIndex++;
}

// deno-lint-ignore no-explicit-any
async function scheduleContinuation(
  supabase: any,
  state: ProcessingState
) {
  console.log(`Scheduling continuation for chunk ${state.chunkIndex}`);

  // Fire and forget (avoid awaiting)
  supabase.functions
    .invoke("process-audio", { body: { state } })
    .catch((err: unknown) => console.error('Failed to schedule continuation:', err));
}

// deno-lint-ignore no-explicit-any
async function finalizeProcessing(
  supabase: any,
  state: ProcessingState
) {
  // Calculate SNR
  const snrDb = state.snrSamples.length > 0 ? calculateSNR(new Int16Array(state.snrSamples)) : null;
  const qualityStatus = snrDb !== null ? (snrDb >= 20 ? 'passed' : 'failed') : 'error';
  
  console.log(`Processing complete: ${state.uploadedChunks.length} chunks, SNR=${snrDb}dB`);

  // Update recording with first chunk URL and SNR
  const { error: updateError } = await supabase
    .from('voice_recordings')
    .update({
      mp3_file_url: state.uploadedChunks[0]?.url || null,
      snr_db: snrDb,
      quality_status: qualityStatus,
      status: 'completed'
    })
    .eq('id', state.recording_id);

  if (updateError) {
    console.error('Failed to update recording:', updateError);
    throw updateError;
  }

  // Start transcription in background
  const task = transcribeAllChunks(supabase, state.recording_id, state.uploadedChunks);
  // @ts-ignore - EdgeRuntime available in Supabase Edge Functions
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(task);
  }

  return new Response(
    JSON.stringify({
      success: true,
      recording_id: state.recording_id,
      chunks: state.uploadedChunks.length,
      snr_db: snrDb,
      quality_status: qualityStatus
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// deno-lint-ignore no-explicit-any
async function transcribeAllChunks(
  supabase: any,
  recording_id: string,
  uploadedChunks: { url: string; index: number }[]
) {
  try {
    const transcriptions: string[] = [];
    let detectedLanguage: string | null = null;

    await supabase.from('voice_recordings')
      .update({ transcription_status: 'processing' })
      .eq('id', recording_id);

    for (const chunk of uploadedChunks) {
      console.log(`Transcribing chunk ${chunk.index}...`);

      const { data, error } = await supabase.functions.invoke('transcribe-audio', {
        body: {
          recording_id: `${recording_id}_chunk_${chunk.index}`,
          audio_url: chunk.url,
          language: detectedLanguage,
        },
      });

      if (error) {
        console.error(`Chunk ${chunk.index} transcription failed:`, error);
        continue;
      }

      const chunkData = (data || {}) as { transcription?: string; detected_language?: string };

      if (chunkData.transcription) {
        transcriptions.push(chunkData.transcription);
      }
      if (!detectedLanguage && chunkData.detected_language) {
        detectedLanguage = chunkData.detected_language;
      }

      console.log(`Chunk ${chunk.index} transcribed: ${chunkData.transcription?.length || 0} chars`);
    }

    // Combine transcriptions
    const fullTranscription = transcriptions.join('\n\n');
    
    const updateData: Record<string, unknown> = {
      transcription: fullTranscription,
      transcription_status: fullTranscription ? 'completed' : 'failed'
    };
    if (detectedLanguage) {
      updateData.language = detectedLanguage.toLowerCase();
    }

    await supabase.from('voice_recordings')
      .update(updateData)
      .eq('id', recording_id);

    console.log(`Full transcription saved: ${fullTranscription.length} chars from ${transcriptions.length} chunks`);
  } catch (err) {
    console.error('Transcription error:', err);
    await supabase.from('voice_recordings')
      .update({ transcription_status: 'failed' })
      .eq('id', recording_id);
  }
}
