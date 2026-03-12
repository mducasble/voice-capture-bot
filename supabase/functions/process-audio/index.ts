import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createMp3Encoder } from "https://esm.sh/wasm-media-encoders@0.7.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const TARGET_SAMPLE_RATE = 16000;
// Use small chunks so we never need to persist partial samples across invocations.
// 30s at 16kHz mono = 480,000 samples. As MP3 at 64kbps ~= 240KB (vs 960KB WAV)
const CHUNK_DURATION_SECONDS = 30;
const SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE * CHUNK_DURATION_SECONDS;
const MAX_PROCESSING_TIME_MS = 8000; // Stop processing after 8 seconds to avoid CPU timeout
const MP3_BITRATE = 128; // 128kbps for good speech quality

// Detect audio format from header bytes
function detectAudioFormat(headerBytes: Uint8Array): 'wav' | 'mp3' | 'unknown' {
  if (headerBytes.length < 4) return 'unknown';
  
  // Check for WAV (RIFF header)
  const riff = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);
  if (riff === 'RIFF') {
    if (headerBytes.length >= 12) {
      const wave = String.fromCharCode(headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]);
      if (wave === 'WAVE') return 'wav';
    }
  }
  
  // Check for MP3 (ID3 tag or frame sync)
  // ID3v2 tag starts with "ID3"
  if (headerBytes[0] === 0x49 && headerBytes[1] === 0x44 && headerBytes[2] === 0x33) {
    return 'mp3';
  }
  // MP3 frame sync (0xFF followed by 0xE* or 0xF*)
  if (headerBytes[0] === 0xFF && (headerBytes[1] & 0xE0) === 0xE0) {
    return 'mp3';
  }
  
  return 'unknown';
}

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

// Decode MP3 to PCM samples using pure JS decoder (no Worker/WASM deps)
async function decodeMp3ToPcm(mp3Buffer: ArrayBuffer): Promise<{ samples: Int16Array; sampleRate: number; channels: number }> {
  const JsMp3 = (await import("https://esm.sh/js-mp3@0.0.1")).default;
  
  const decoder = JsMp3.newDecoder(mp3Buffer);
  const pcmBuffer = decoder.decode();
  
  if (!pcmBuffer || pcmBuffer.byteLength === 0) {
    throw new Error('Failed to decode MP3');
  }
  
  // js-mp3 outputs interleaved 16-bit PCM at the source sample rate
  // Default MP3 sample rates: 44100, 48000, 32000, etc.
  const inputSampleRate = decoder.sampleRate || 44100;
  const inputChannels = decoder.channels || 2;
  const inputPcm = new Int16Array(pcmBuffer);
  const inputSamplesPerChannel = Math.floor(inputPcm.length / inputChannels);
  
  console.log(`MP3 decoded: ${inputSamplesPerChannel} samples/ch, ${inputSampleRate}Hz, ${inputChannels} channels, PCM size: ${pcmBuffer.byteLength}`);
  
  // Convert to mono Int16Array at target sample rate
  const resampleRatio = TARGET_SAMPLE_RATE / inputSampleRate;
  const outputSamples = Math.floor(inputSamplesPerChannel * resampleRatio);
  const samples = new Int16Array(outputSamples);
  
  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i / resampleRatio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;
    const nextIndex = Math.min(srcIndex + 1, inputSamplesPerChannel - 1);
    
    // Mix all channels to mono with linear interpolation
    let monoSample = 0;
    for (let ch = 0; ch < inputChannels; ch++) {
      const sample1 = inputPcm[srcIndex * inputChannels + ch] || 0;
      const sample2 = inputPcm[nextIndex * inputChannels + ch] || 0;
      monoSample += sample1 + (sample2 - sample1) * frac;
    }
    monoSample /= inputChannels;
    
    // Already Int16, just clamp
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(monoSample)));
  }
  
  console.log(`Resampled to ${outputSamples} samples at ${TARGET_SAMPLE_RATE}Hz mono`);
  
  return { samples, sampleRate: TARGET_SAMPLE_RATE, channels: 1 };
}

// Voice Activity Detection (VAD) - finds regions with speech
// Uses short-term energy analysis with adaptive threshold
interface SpeechRegion {
  start: number;
  end: number;
  energy: number;
}

function detectSpeechRegions(samples: Int16Array, sampleRate: number): SpeechRegion[] {
  if (samples.length === 0) return [];
  
  // Use 20ms windows for energy analysis (common for VAD)
  const windowSize = Math.floor(sampleRate * 0.02);
  const hopSize = Math.floor(windowSize / 2); // 50% overlap
  const numWindows = Math.floor((samples.length - windowSize) / hopSize) + 1;
  
  if (numWindows < 3) return [];
  
  // Calculate energy for each window
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
  
  // Sort energies to find noise floor (bottom 20%)
  const sortedEnergies = [...energies].sort((a, b) => a - b);
  const noiseFloorIdx = Math.floor(sortedEnergies.length * 0.2);
  let noiseFloorEnergy = 0;
  for (let i = 0; i < noiseFloorIdx; i++) {
    noiseFloorEnergy += sortedEnergies[i];
  }
  noiseFloorEnergy = noiseFloorIdx > 0 ? noiseFloorEnergy / noiseFloorIdx : 0.0001;
  
  // Adaptive threshold: 3x the noise floor (typically works well for speech)
  const threshold = Math.max(noiseFloorEnergy * 3, 0.0001);
  
  console.log(`VAD: ${numWindows} windows, noise floor=${noiseFloorEnergy.toExponential(2)}, threshold=${threshold.toExponential(2)}`);
  
  // Find contiguous regions above threshold
  const regions: SpeechRegion[] = [];
  let inSpeech = false;
  let regionStart = 0;
  let regionEnergy = 0;
  let regionCount = 0;
  
  // Minimum speech duration: 100ms (5 windows at 20ms hop)
  const minSpeechWindows = 5;
  // Hangover: keep speech active for 200ms after energy drops (10 windows)
  const hangoverWindows = 10;
  let hangoverCounter = 0;
  
  for (let w = 0; w < numWindows; w++) {
    const isAboveThreshold = energies[w] > threshold;
    
    if (!inSpeech && isAboveThreshold) {
      // Start of potential speech
      inSpeech = true;
      regionStart = w * hopSize;
      regionEnergy = energies[w];
      regionCount = 1;
      hangoverCounter = hangoverWindows;
    } else if (inSpeech) {
      if (isAboveThreshold) {
        regionEnergy += energies[w];
        regionCount++;
        hangoverCounter = hangoverWindows; // Reset hangover
      } else {
        hangoverCounter--;
        if (hangoverCounter <= 0) {
          // End of speech region
          if (regionCount >= minSpeechWindows) {
            const regionEnd = Math.min(w * hopSize + windowSize, samples.length);
            regions.push({
              start: regionStart,
              end: regionEnd,
              energy: regionEnergy / regionCount
            });
          }
          inSpeech = false;
        }
      }
    }
  }
  
  // Handle speech that continues to the end
  if (inSpeech && regionCount >= minSpeechWindows) {
    regions.push({
      start: regionStart,
      end: samples.length,
      energy: regionEnergy / regionCount
    });
  }
  
  console.log(`VAD: Found ${regions.length} speech regions`);
  return regions;
}

// Calculate RMS Level in dBFS from audio samples
function calculateRMSLevel(samples: Int16Array): number {
  if (samples.length === 0) return -96.0; // Silence
  
  // Calculate RMS from all samples
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768.0;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / samples.length);
  
  // Convert to dBFS (0 dBFS = full scale 1.0)
  if (rms === 0) return -96.0; // Silence floor
  const dbfs = 20 * Math.log10(rms);
  
  // Clamp to reasonable range (-96 to 0 dBFS)
  const clamped = Math.max(-96.0, Math.min(0, dbfs));
  console.log(`RMS Level: ${rms.toExponential(2)} linear = ${clamped.toFixed(1)} dBFS`);
  return Math.round(clamped * 10) / 10;
}

// Calculate SNR from audio samples using VAD-based speech detection
// Only analyzes regions where speech is actually present
function calculateSNR(samples: Int16Array, sampleRate: number = 16000): number {
  if (samples.length === 0) return 0;
  
  // Detect speech regions
  const speechRegions = detectSpeechRegions(samples, sampleRate);
  
  // If no speech detected, return low SNR
  if (speechRegions.length === 0) {
    console.log('SNR: No speech regions detected');
    return 5.0;
  }
  
  // Extract samples from speech regions only
  const speechSamples: number[] = [];
  for (const region of speechRegions) {
    for (let i = region.start; i < region.end; i++) {
      speechSamples.push(samples[i] / 32768.0);
    }
  }
  
  const speechRatio = speechSamples.length / samples.length;
  console.log(`SNR: Analyzing ${speechSamples.length} speech samples (${(speechRatio * 100).toFixed(1)}% of total)`);
  
  // If very little speech content, return low but valid SNR
  if (speechSamples.length < sampleRate * 0.5) { // Less than 0.5 seconds of speech
    console.log('SNR: Insufficient speech content (< 0.5s)');
    return 8.0;
  }
  
  // Calculate signal RMS from speech samples
  let signalSum = 0;
  for (const sample of speechSamples) {
    signalSum += sample * sample;
  }
  const signalRMS = Math.sqrt(signalSum / speechSamples.length);
  
  if (signalRMS < 0.001) {
    return 5.0;
  }
  
  // Estimate noise floor from non-speech regions (silence padding)
  const silenceSamples: number[] = [];
  let lastEnd = 0;
  for (const region of speechRegions) {
    // Get samples between speech regions
    for (let i = lastEnd; i < region.start; i++) {
      silenceSamples.push(samples[i] / 32768.0);
    }
    lastEnd = region.end;
  }
  // Add trailing silence
  for (let i = lastEnd; i < samples.length; i++) {
    silenceSamples.push(samples[i] / 32768.0);
  }
  
  let noiseFloor: number;
  
  if (silenceSamples.length >= sampleRate * 0.2) { // At least 200ms of silence
    // Calculate noise RMS from silence regions
    let noiseSum = 0;
    for (const sample of silenceSamples) {
      noiseSum += sample * sample;
    }
    noiseFloor = Math.sqrt(noiseSum / silenceSamples.length);
    console.log(`SNR: Using ${silenceSamples.length} silence samples for noise floor`);
  } else {
    // Not enough silence - use bottom 10% of speech samples
    const sortedAbs = speechSamples.map(Math.abs).sort((a, b) => a - b);
    const bottomCount = Math.max(1, Math.floor(sortedAbs.length * 0.1));
    let noiseSum = 0;
    for (let i = 0; i < bottomCount; i++) {
      noiseSum += sortedAbs[i] * sortedAbs[i];
    }
    noiseFloor = Math.sqrt(noiseSum / bottomCount);
    console.log(`SNR: Using bottom 10% of speech samples for noise floor (no silence available)`);
  }
  
  // Prevent division by zero
  if (noiseFloor < 0.0001) {
    // Very clean signal
    return 60.0;
  }
  
  const snr = 20 * Math.log10(signalRMS / noiseFloor);
  
  // Clamp to reasonable range
  if (!isFinite(snr) || snr > 100) return 60.0;
  if (snr < 0) return 5.0;
  
  console.log(`SNR: signal=${signalRMS.toExponential(2)}, noise=${noiseFloor.toExponential(2)}, SNR=${snr.toFixed(1)}dB`);
  return Math.round(snr * 10) / 10;
}

// Apply noise gate to samples - zeros out samples below adaptive threshold

// Apply noise gate to samples - zeros out samples below adaptive threshold
// Uses VAD-like energy analysis to determine gate threshold
function applyNoiseGate(samples: Int16Array, sampleRate: number): Int16Array {
  if (samples.length === 0) return samples;
  
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms windows
  const hopSize = Math.floor(windowSize / 2);
  const numWindows = Math.floor((samples.length - windowSize) / hopSize) + 1;
  
  if (numWindows < 3) return samples;
  
  // Calculate energy per window
  const energies: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    let energy = 0;
    for (let i = 0; i < windowSize && start + i < samples.length; i++) {
      const s = samples[start + i] / 32768.0;
      energy += s * s;
    }
    energies.push(energy / windowSize);
  }
  
  // Noise floor from bottom 20% of windows
  const sorted = [...energies].sort((a, b) => a - b);
  const noiseIdx = Math.floor(sorted.length * 0.2);
  let noiseFloor = 0;
  for (let i = 0; i < noiseIdx; i++) noiseFloor += sorted[i];
  noiseFloor = noiseIdx > 0 ? noiseFloor / noiseIdx : 0.0001;
  
  // Gate threshold: 2x noise floor (gentler than VAD's 3x)
  const gateThreshold = Math.max(noiseFloor * 2, 0.00005);
  
  console.log(`Noise Gate: threshold=${gateThreshold.toExponential(2)}, noise_floor=${noiseFloor.toExponential(2)}`);
  
  // Apply gate with 5ms attack/release for smooth transitions
  const fadeLength = Math.floor(sampleRate * 0.005);
  const output = new Int16Array(samples.length);
  let gateOpen = false;
  let fadeCounter = 0;
  
  for (let w = 0; w < numWindows; w++) {
    const isAbove = energies[w] > gateThreshold;
    const start = w * hopSize;
    const end = Math.min(start + hopSize, samples.length);
    
    if (isAbove && !gateOpen) {
      gateOpen = true;
      fadeCounter = fadeLength;
    } else if (!isAbove && gateOpen) {
      gateOpen = false;
      fadeCounter = fadeLength;
    }
    
    for (let i = start; i < end; i++) {
      if (gateOpen) {
        if (fadeCounter > 0) {
          // Fade in
          const gain = 1.0 - (fadeCounter / fadeLength);
          output[i] = Math.round(samples[i] * gain);
          fadeCounter--;
        } else {
          output[i] = samples[i];
        }
      } else {
        if (fadeCounter > 0) {
          // Fade out
          const gain = fadeCounter / fadeLength;
          output[i] = Math.round(samples[i] * gain);
          fadeCounter--;
        } else {
          output[i] = 0;
        }
      }
    }
  }
  
  // Count gated samples for logging
  let gatedCount = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] === 0 && samples[i] !== 0) gatedCount++;
  }
  console.log(`Noise Gate: gated ${gatedCount}/${samples.length} samples (${(gatedCount/samples.length*100).toFixed(1)}%)`);
  
  return output;
}

// Encode samples to MP3 using WASM encoder
async function encodeToMp3(samples: Int16Array, sampleRate: number): Promise<Uint8Array> {
  const encoder = await createMp3Encoder();
  
  encoder.configure({
    sampleRate: sampleRate,
    channels: 1,
    bitrate: MP3_BITRATE,
  });
  
  // Convert Int16Array to Float32Array (-1.0 to 1.0)
  const floatSamples = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    floatSamples[i] = samples[i] / 32768.0;
  }
  
  // Encode - pass as array of channels (mono = single channel)
  const mp3Data = encoder.encode([floatSamples]);
  const finalFrames = encoder.finalize();
  
  // Combine encoded data with final frames
  const fullMp3 = new Uint8Array(mp3Data.length + finalFrames.length);
  fullMp3.set(mp3Data);
  fullMp3.set(finalFrames, mp3Data.length);
  
  return fullMp3;
}

interface ProcessingState {
  recording_id: string;
  audio_url: string;
  timestamp: string;
  format: 'wav' | 'mp3';
  header: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    dataOffset: number;
    dataSize: number;
  };
  // For MP3: pre-decoded samples
  mp3Samples?: number[];
  mp3SampleIndex?: number;
  bytesProcessed: number;
  srcIdx: number;
  outputSampleIdx: number;
  chunkIndex: number;
  uploadedChunks: { url: string; index: number }[];
  snrDb: number | null;
  rmsDbfs: number | null;
  snrSamples: number[];
  noiseGateEnabled?: boolean;
  file_url?: string;
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
      const { recording_id, audio_url, noise_gate_enabled } = body;
      const noiseGateEnabled = noise_gate_enabled === true;

      if (!recording_id || !audio_url) {
        return new Response(
          JSON.stringify({ error: 'Missing recording_id or audio_url' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Starting new processing for recording ${recording_id}`);

      // Update status to processing
      await supabase.from('voice_recordings').update({ status: 'processing' }).eq('id', recording_id);

      // Fetch header to detect format
      const headerResponse = await fetch(audio_url, {
        headers: { 'Range': 'bytes=0-1023' }
      });
      
      if (!headerResponse.ok && headerResponse.status !== 206) {
        throw new Error(`Failed to fetch audio header: ${headerResponse.status}`);
      }

      const headerBytes = new Uint8Array(await headerResponse.arrayBuffer());
      const audioFormat = detectAudioFormat(headerBytes);
      
      console.log(`Detected audio format: ${audioFormat}`);

      if (audioFormat === 'mp3') {
        // For MP3: fetch entire file and decode
        console.log('Fetching entire MP3 file for decoding...');
        const fullResponse = await fetch(audio_url);
        if (!fullResponse.ok) {
          throw new Error(`Failed to fetch MP3: ${fullResponse.status}`);
        }
        const mp3Buffer = await fullResponse.arrayBuffer();
        console.log(`MP3 file size: ${mp3Buffer.byteLength} bytes`);
        
        const { samples } = await decodeMp3ToPcm(mp3Buffer);
        
        // Create state with pre-decoded samples
        state = {
          recording_id,
          audio_url,
          timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
          format: 'mp3',
          header: {
            sampleRate: TARGET_SAMPLE_RATE,
            channels: 1,
            bitsPerSample: 16,
            dataOffset: 0,
            dataSize: samples.length * 2,
          },
          mp3Samples: Array.from(samples),
          mp3SampleIndex: 0,
          bytesProcessed: 0,
          srcIdx: 0,
          outputSampleIdx: 0,
          chunkIndex: 0,
           uploadedChunks: [],
           snrDb: null,
           rmsDbfs: null,
           snrSamples: [],
           noiseGateEnabled,
        };
        
        console.log(`MP3 decoded to ${samples.length} samples, ready for chunking`);
      } else if (audioFormat === 'wav') {
        const header = parseWavHeader(headerBytes);
        
        if (!header) {
          throw new Error('Invalid WAV file');
        }

        console.log(`WAV Audio: ${header.sampleRate}Hz, ${header.channels}ch, ${header.bitsPerSample}bit, data at ${header.dataOffset}, size ${header.dataSize}`);

        state = {
          recording_id,
          audio_url,
          timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
          format: 'wav',
          header,
          bytesProcessed: 0,
          srcIdx: 0,
          outputSampleIdx: 0,
          chunkIndex: 0,
          uploadedChunks: [],
          snrDb: null,
          rmsDbfs: null,
          snrSamples: [],
          noiseGateEnabled,
        };
      } else {
        throw new Error(`Unsupported audio format. Expected WAV or MP3.`);
      }
    }

    const { header } = state;
    const snrSampleTarget = TARGET_SAMPLE_RATE * 5; // 5 seconds for SNR

    // Handle MP3 (already decoded) vs WAV (streaming)
    if (state.format === 'mp3' && state.mp3Samples) {
      // MP3 is already decoded - process samples directly
      const samples = state.mp3Samples;
      const mp3SampleIndex = state.mp3SampleIndex || 0;
      let chunkSamples: number[] = [];
      let currentIndex = mp3SampleIndex;

      while (currentIndex < samples.length) {
        // Check if we're running out of time
        if (Date.now() - startTime > MAX_PROCESSING_TIME_MS) {
          console.log(`Time limit approaching at chunk ${state.chunkIndex}. Uploading partial audio and continuing...`);

          if (chunkSamples.length > 0) {
            await uploadChunk(supabase, state, new Int16Array(chunkSamples));
            chunkSamples = [];
          }

          state.mp3SampleIndex = currentIndex;

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

        const sample = samples[currentIndex];
        chunkSamples.push(sample);

        // Collect SNR samples
        if (state.snrSamples.length < snrSampleTarget) {
          state.snrSamples.push(sample);
        }

        // Check if chunk is complete
        if (chunkSamples.length >= SAMPLES_PER_CHUNK) {
          await uploadChunk(supabase, state, new Int16Array(chunkSamples));
          chunkSamples = [];
        }

        currentIndex++;
      }

      // Upload final partial chunk
      if (chunkSamples.length > 0) {
        await uploadChunk(supabase, state, new Int16Array(chunkSamples));
      }

      state.mp3SampleIndex = currentIndex;
      return await finalizeProcessing(supabase, state);

    } else {
      // WAV: streaming processing
      const ratio = header.sampleRate / TARGET_SAMPLE_RATE;
      const bytesPerFrame = header.channels * (header.bitsPerSample / 8);

      // Calculate how much data to fetch this iteration
      const bytesPerSecondSource = header.sampleRate * bytesPerFrame;
      const bytesToFetch = bytesPerSecondSource * 30;
      
      const rangeStart = header.dataOffset + state.bytesProcessed;
      const rangeEnd = Math.min(
        rangeStart + bytesToFetch - 1,
        header.dataOffset + header.dataSize - 1
      );

      if (rangeStart > header.dataOffset + header.dataSize) {
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

      const view = new DataView(audioData.buffer, audioData.byteOffset, audioData.byteLength);
      let frameOffset = 0;
      let chunkSamples: number[] = [];

      while (frameOffset + bytesPerFrame <= audioData.length) {
        if (Date.now() - startTime > MAX_PROCESSING_TIME_MS) {
          console.log(`Time limit approaching at chunk ${state.chunkIndex}. Uploading partial audio and continuing...`);

          if (chunkSamples.length > 0) {
            await uploadChunk(supabase, state, new Int16Array(chunkSamples));
            chunkSamples = [];
          }

          state.bytesProcessed += frameOffset;

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
          let sample = 0;
          for (let ch = 0; ch < header.channels; ch++) {
            sample += view.getInt16(frameOffset + ch * 2, true);
          }
          const monoSample = Math.round(sample / header.channels);

          chunkSamples.push(monoSample);
          state.outputSampleIdx++;

          if (state.snrSamples.length < snrSampleTarget) {
            state.snrSamples.push(monoSample);
          }

          if (chunkSamples.length >= SAMPLES_PER_CHUNK) {
            await uploadChunk(supabase, state, new Int16Array(chunkSamples));
            chunkSamples = [];
          }
        }

        state.srcIdx++;
        frameOffset += bytesPerFrame;
      }

      state.bytesProcessed += frameOffset;

      if (chunkSamples.length > 0) {
        await uploadChunk(supabase, state, new Int16Array(chunkSamples));
      }

      const isComplete = state.bytesProcessed >= header.dataSize;

      if (isComplete) {
        return await finalizeProcessing(supabase, state);
      }

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
    }

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
  // Apply noise gate if enabled
  const processedSamples = state.noiseGateEnabled ? applyNoiseGate(samples, TARGET_SAMPLE_RATE) : samples;
  console.log(`Encoding chunk ${state.chunkIndex} with ${processedSamples.length} samples to MP3${state.noiseGateEnabled ? ' (noise gate ON)' : ''}`);
  
  try {
    // Encode to MP3
    const mp3Data = await encodeToMp3(processedSamples, TARGET_SAMPLE_RATE);
    console.log(`Chunk ${state.chunkIndex}: ${processedSamples.length} samples -> ${(mp3Data.length / 1024).toFixed(1)} KB MP3`);
    
    const chunkPath = `chunks/${state.recording_id}_${state.timestamp}_chunk${String(state.chunkIndex).padStart(3, '0')}.mp3`;
    
    const { error: uploadError } = await supabase.storage
      .from('voice-recordings')
      .upload(chunkPath, mp3Data, {
        contentType: 'audio/mpeg',
        upsert: true
      });
    
    if (uploadError) {
      console.error(`Failed to upload MP3 chunk ${state.chunkIndex}:`, uploadError);
      throw uploadError;
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('voice-recordings')
      .getPublicUrl(chunkPath);
    
    state.uploadedChunks.push({ url: publicUrl, index: state.chunkIndex });
    console.log(`Uploaded MP3 chunk ${state.chunkIndex}: ${publicUrl}`);
    
  } catch (encodeError) {
    // Fallback to WAV if MP3 encoding fails
    console.warn(`MP3 encoding failed for chunk ${state.chunkIndex}, falling back to WAV:`, encodeError);
    
    const wavData = createWavChunk(processedSamples, TARGET_SAMPLE_RATE);
    console.log(`Chunk ${state.chunkIndex}: ${processedSamples.length} samples -> ${(wavData.length / 1024).toFixed(1)} KB WAV (fallback)`);
    
    const chunkPath = `chunks/${state.recording_id}_${state.timestamp}_chunk${String(state.chunkIndex).padStart(3, '0')}.wav`;
    
    const { error: uploadError } = await supabase.storage
      .from('voice-recordings')
      .upload(chunkPath, wavData, {
        contentType: 'audio/wav',
        upsert: true
      });
    
    if (uploadError) {
      console.error(`Failed to upload WAV chunk ${state.chunkIndex}:`, uploadError);
      throw uploadError;
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('voice-recordings')
      .getPublicUrl(chunkPath);
    
    state.uploadedChunks.push({ url: publicUrl, index: state.chunkIndex });
    console.log(`Uploaded WAV chunk ${state.chunkIndex} (fallback): ${publicUrl}`);
  }
  
  state.chunkIndex++;
}

// Create WAV chunk from samples (fallback if MP3 fails)
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

// deno-lint-ignore no-explicit-any
async function scheduleContinuation(
  supabase: any,
  state: ProcessingState
) {
  console.log(`Scheduling continuation for chunk ${state.chunkIndex}`);

  // Save partial progress to database so UI can show progress
  const estimatedTotalChunks = Math.ceil(state.header.dataSize / (state.header.sampleRate * state.header.channels * (state.header.bitsPerSample / 8) * CHUNK_DURATION_SECONDS / (state.header.sampleRate / TARGET_SAMPLE_RATE)));
  
  try {
    // Merge with existing metadata to preserve audio_profile etc.
    const { data: existingRec } = await supabase
      .from('voice_recordings')
      .select('metadata')
      .eq('id', state.recording_id)
      .single();
    const existingMeta = (existingRec?.metadata || {}) as Record<string, unknown>;

    await supabase
      .from('voice_recordings')
      .update({
        metadata: {
          ...existingMeta,
          chunk_generation_progress: {
            chunks_completed: state.uploadedChunks.length,
            estimated_total: estimatedTotalChunks,
            bytes_processed: state.bytesProcessed,
            total_bytes: state.header.dataSize,
            updated_at: new Date().toISOString()
          }
        }
      })
      .eq('id', state.recording_id);
  } catch (e) {
    console.error('Failed to update chunk progress:', e);
  }

  const invokePromise = supabase.functions.invoke("process-audio", { body: { state } });

  // Ensure the continuation request actually gets sent even if this invocation returns quickly.
  // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(
      invokePromise
        .then(({ error }: { error?: unknown }) => {
          if (error) console.error("Failed to schedule continuation:", error);
        })
        .catch((err: unknown) => console.error("Failed to schedule continuation:", err))
    );
    return;
  }

  // Fallback: await so the request is not dropped.
  const { error } = await invokePromise;
  if (error) console.error("Failed to schedule continuation:", error);
}


// deno-lint-ignore no-explicit-any
async function finalizeProcessing(
  supabase: any,
  state: ProcessingState
) {
  // Calculate SNR and RMS using VAD-based speech detection
  const snrDb = state.snrSamples.length > 0 ? calculateSNR(new Int16Array(state.snrSamples), TARGET_SAMPLE_RATE) : null;
  const rmsDbfs = state.snrSamples.length > 0 ? calculateRMSLevel(new Int16Array(state.snrSamples)) : null;
  
  // Updated threshold: SNR >= 25 dB, RMS: -26 to -20 dBFS
   const qualityStatus = 
    snrDb !== null && rmsDbfs !== null
      ? (snrDb >= 25 && rmsDbfs >= -26 && rmsDbfs <= -20 ? 'passed' : 'failed')
      : 'error';
  
  console.log(`Processing complete: ${state.uploadedChunks.length} chunks, SNR=${snrDb}dB, RMS=${rmsDbfs}dBFS`);

  // Save chunk state for resumable Gemini transcription
  const geminiChunkState = {
    chunkUrls: state.uploadedChunks,
    nextIndex: 0,
    transcriptions: [] as string[],
    chunkSegments: [] as { start: string; end: string; speaker: string; text: string }[][],
    detectedLanguage: null as string | null,
    lockedAt: null as string | null
  };

  // Merge with existing metadata to preserve audio_profile etc.
  const { data: existingRec2 } = await supabase
    .from('voice_recordings')
    .select('metadata')
    .eq('id', state.recording_id)
    .single();
  const existingMeta2 = (existingRec2?.metadata || {}) as Record<string, unknown>;

  // Update recording with SNR + RMS + quality + chunk state
  const { error: updateError } = await supabase
    .from('voice_recordings')
    .update({
      snr_db: snrDb,
      quality_status: qualityStatus,
      status: 'completed',
      gemini_chunk_state: geminiChunkState,
      transcription_status: 'pending',
      metadata: {
        ...existingMeta2,
        rms_dbfs: rmsDbfs,
        quality_metrics: {
          snr_db: snrDb,
          rms_dbfs: rmsDbfs,
          required_snr: 25,
          required_rms_range: '-26 to -20 dBFS'
        }
      }
    })
    .eq('id', state.recording_id);

  if (updateError) {
    console.error('Failed to update recording:', updateError);
    throw updateError;
  }

  // Start Gemini transcription with chunk-based processing (non-blocking)
  transcribeChunksWithRetry(supabase, state.recording_id);

  // Estimate MOS score using Lovable AI (non-blocking)
  estimateMOSScore(supabase, state.recording_id, state.audio_url, snrDb, rmsDbfs);

  // Estimate advanced audio metrics using HuggingFace Space (non-blocking)
  estimateAdvancedMetrics(supabase, state.recording_id, state.audio_url, snrDb, rmsDbfs);

  // DISABLED: Automatic ElevenLabs transcription to save credits during testing
  // To re-enable, uncomment the following block:
  /*
  const elevenLabsPromise = supabase.functions.invoke("transcribe-elevenlabs", {
    body: {
      recording_id: state.recording_id,
      mode: "chunks",
    },
  });

  // @ts-ignore - EdgeRuntime available
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(
      elevenLabsPromise
        .then(({ error }: { error?: unknown }) => {
          if (error) console.error("ElevenLabs trigger failed:", error);
          else console.log(`ElevenLabs transcription started for ${state.recording_id}`);
        })
        .catch((err: unknown) => console.error("ElevenLabs trigger error:", err))
    );
  } else {
    elevenLabsPromise
      .then(({ error }: { error?: unknown }) => {
        if (error) console.error("ElevenLabs trigger failed:", error);
      })
      .catch((err: unknown) => console.error("ElevenLabs trigger error:", err));
  }
  */
  console.log(`ElevenLabs auto-transcription DISABLED for ${state.recording_id} (can be triggered manually from UI)`);

  return new Response(
    JSON.stringify({
      success: true,
      recording_id: state.recording_id,
      chunks: state.uploadedChunks.length,
      snr_db: snrDb,
      rms_dbfs: rmsDbfs,
      quality_status: qualityStatus
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Estimate MOS score using Lovable AI (non-blocking)
// deno-lint-ignore no-explicit-any
function estimateMOSScore(
  supabase: any,
  recording_id: string,
  file_url: string,
  snr_db: number | null,
  rms_dbfs: number | null
) {
  const invokePromise = supabase.functions.invoke('estimate-mos', {
    body: { recording_id, file_url, snr_db, rms_dbfs }
  });

  // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(
      invokePromise.catch((err: unknown) => console.error("Failed to estimate MOS score:", err))
    );
  } else {
    invokePromise.catch((err: unknown) => console.error("Failed to estimate MOS score:", err));
  }
}

// Estimate advanced audio metrics using Lovable AI (non-blocking)
// deno-lint-ignore no-explicit-any
function estimateAdvancedMetrics(
  supabase: any,
  recording_id: string,
  file_url: string,
  snr_db: number | null,
  rms_dbfs: number | null
) {
  const invokePromise = supabase.functions.invoke('estimate-audio-metrics', {
    body: { recording_id, file_url, snr_db, rms_dbfs }
  });

  // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(
      invokePromise.catch((err: unknown) => console.error("Failed to estimate advanced metrics:", err))
    );
  } else {
    invokePromise.catch((err: unknown) => console.error("Failed to estimate advanced metrics:", err));
  }
}

// Trigger transcribe-gemini-continue using waitUntil to avoid blocking
// deno-lint-ignore no-explicit-any
function transcribeChunksWithRetry(
  supabase: any,
  recording_id: string
) {
  console.log(`Triggering transcribe-gemini-continue for ${recording_id}`);
  
  const invokePromise = supabase.functions.invoke('transcribe-gemini-continue', {
    body: { recording_id }
  }).then(({ error }: { error?: unknown }) => {
    if (error) {
      console.error('Failed to trigger transcription:', error);
      return supabase.from('voice_recordings')
        .update({ transcription_status: 'failed' })
        .eq('id', recording_id);
    }
    console.log(`Transcription started successfully for ${recording_id}`);
  }).catch((err: unknown) => {
    console.error('Transcription trigger failed:', err);
    return supabase.from('voice_recordings')
      .update({ transcription_status: 'failed' })
      .eq('id', recording_id);
  });

  // @ts-ignore - EdgeRuntime available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(invokePromise);
  }
}
