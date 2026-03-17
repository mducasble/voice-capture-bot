import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-api-key',
};

// Parse WAV file and extract PCM samples
function parseWavFile(arrayBuffer: ArrayBuffer): { samples: Float32Array; sampleRate: number; channels: number; bitsPerSample: number } | null {
  const view = new DataView(arrayBuffer);
  
  // Check RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') {
    console.error('Not a valid RIFF file');
    return null;
  }
  
  // Check WAVE format
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') {
    console.error('Not a valid WAVE file');
    return null;
  }
  
  // Find fmt chunk
  let offset = 12;
  let sampleRate = 48000;
  let channels = 2;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;
  
  while (offset < arrayBuffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
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
    // Align to even boundary
    if (chunkSize % 2 !== 0) offset++;
  }
  
  if (dataOffset === 0 || dataSize === 0) {
    console.error('Could not find data chunk');
    return null;
  }
  
  // Extract samples (16-bit PCM)
  const numSamples = Math.floor(dataSize / (bitsPerSample / 8));
  const samples = new Float32Array(numSamples);
  
  for (let i = 0; i < numSamples; i++) {
    const sampleOffset = dataOffset + i * 2;
    if (sampleOffset + 2 <= arrayBuffer.byteLength) {
      const sample = view.getInt16(sampleOffset, true);
      samples[i] = sample / 32768.0; // Normalize to -1.0 to 1.0
    }
  }
  
  return { samples, sampleRate, channels, bitsPerSample };
}

// Extract Int16 samples from WAV for MP3 encoding
function extractInt16Samples(arrayBuffer: ArrayBuffer): { leftChannel: Int16Array; rightChannel: Int16Array; sampleRate: number; channels: number } | null {
  const view = new DataView(arrayBuffer);
  
  // Check RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') return null;
  
  // Check WAVE format
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') return null;
  
  let offset = 12;
  let sampleRate = 48000;
  let channels = 2;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;
  
  while (offset < arrayBuffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1), 
      view.getUint8(offset + 2), view.getUint8(offset + 3)
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
  
  if (dataOffset === 0 || dataSize === 0) return null;
  
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const samplesPerChannel = Math.floor(totalSamples / channels);
  
  const leftChannel = new Int16Array(samplesPerChannel);
  const rightChannel = new Int16Array(samplesPerChannel);
  
  for (let i = 0; i < samplesPerChannel; i++) {
    const frameOffset = dataOffset + i * channels * bytesPerSample;
    
    // Left channel
    if (frameOffset + bytesPerSample <= arrayBuffer.byteLength) {
      leftChannel[i] = view.getInt16(frameOffset, true);
    }
    
    // Right channel (or copy left if mono)
    if (channels >= 2 && frameOffset + 2 * bytesPerSample <= arrayBuffer.byteLength) {
      rightChannel[i] = view.getInt16(frameOffset + bytesPerSample, true);
    } else {
      rightChannel[i] = leftChannel[i];
    }
  }
  
  return { leftChannel, rightChannel, sampleRate, channels };
}

// Simple MP3 encoding using lamejs-compatible approach
// We'll create a simpler compressed format - actually just downsample and reduce quality WAV
// Since lamejs requires complex WASM setup, we'll create a smaller WAV instead
function createCompressedWav(leftChannel: Int16Array, rightChannel: Int16Array, originalSampleRate: number): Uint8Array {
  // Downsample to 16kHz mono for analysis/transcription (much smaller file)
  const targetSampleRate = 16000;
  const ratio = originalSampleRate / targetSampleRate;
  const newLength = Math.floor(leftChannel.length / ratio);
  
  // Mix to mono and downsample
  const monoSamples = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = Math.floor(i * ratio);
    // Mix stereo to mono
    const left = leftChannel[srcIdx] || 0;
    const right = rightChannel[srcIdx] || 0;
    monoSamples[i] = Math.round((left + right) / 2);
  }
  
  // Create WAV header for mono 16kHz 16-bit
  const dataSize = monoSamples.length * 2;
  const fileSize = 44 + dataSize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write samples
  for (let i = 0; i < monoSamples.length; i++) {
    view.setInt16(44 + i * 2, monoSamples[i], true);
  }
  
  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Voice Activity Detection (VAD) - finds regions with speech
interface SpeechRegion {
  start: number;
  end: number;
  energy: number;
}

function detectSpeechRegions(samples: Float32Array, sampleRate: number): SpeechRegion[] {
  if (samples.length === 0) return [];
  
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms windows
  const hopSize = Math.floor(windowSize / 2);
  const numWindows = Math.floor((samples.length - windowSize) / hopSize) + 1;
  
  if (numWindows < 3) return [];
  
  const energies: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    let energy = 0;
    for (let i = 0; i < windowSize && start + i < samples.length; i++) {
      energy += samples[start + i] * samples[start + i];
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
            regions.push({
              start: regionStart,
              end: Math.min(w * hopSize + windowSize, samples.length),
              energy: regionEnergy / regionCount
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
      energy: regionEnergy / regionCount
    });
  }
  
  return regions;
}

// Calculate SNR using VAD-based speech detection
function calculateSNR(samples: Float32Array, sampleRate: number): number {
  if (samples.length === 0) return 0;
  
  const speechRegions = detectSpeechRegions(samples, sampleRate);
  
  if (speechRegions.length === 0) {
    console.log('SNR: No speech regions detected');
    return 5.0;
  }
  
  // Extract speech samples
  const speechSamples: number[] = [];
  for (const region of speechRegions) {
    for (let i = region.start; i < region.end; i++) {
      speechSamples.push(samples[i]);
    }
  }
  
  console.log(`SNR: Found ${speechRegions.length} speech regions, ${speechSamples.length} samples (${(speechSamples.length / samples.length * 100).toFixed(1)}%)`);
  
  if (speechSamples.length < sampleRate * 0.5) {
    return 8.0;
  }
  
  // Calculate signal RMS
  let signalSum = 0;
  for (const sample of speechSamples) {
    signalSum += sample * sample;
  }
  const signalRMS = Math.sqrt(signalSum / speechSamples.length);
  
  if (signalRMS < 0.001) return 5.0;
  
  // Get noise floor from silence regions
  const silenceSamples: number[] = [];
  let lastEnd = 0;
  for (const region of speechRegions) {
    for (let i = lastEnd; i < region.start; i++) {
      silenceSamples.push(samples[i]);
    }
    lastEnd = region.end;
  }
  for (let i = lastEnd; i < samples.length; i++) {
    silenceSamples.push(samples[i]);
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
  
  if (noiseFloor < 0.0001) return 60.0;
  
  const snr = 20 * Math.log10(signalRMS / noiseFloor);
  
  if (!isFinite(snr) || snr > 100) return 60.0;
  if (snr < 0) return 5.0;
  
  return Math.round(snr * 10) / 10;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate bot API key
    const botApiKey = req.headers.get('x-bot-api-key');
    const expectedApiKey = Deno.env.get('BOT_API_KEY');
    
    console.log('Auth check:', { 
      hasReceivedKey: !!botApiKey, 
      hasExpectedKey: !!expectedApiKey,
      keysMatch: botApiKey === expectedApiKey
    });
    
    if (!botApiKey || botApiKey !== expectedApiKey) {
      console.error('Invalid or missing bot API key');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const metadata = JSON.parse(formData.get('metadata') as string || '{}');

    if (!audioFile) {
      return new Response(
        JSON.stringify({ error: 'No audio file provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Received upload request:', {
      filename: metadata.filename,
      guildId: metadata.discord_guild_id,
      userId: metadata.discord_user_id,
      fileSize: audioFile.size
    });

    // Read the WAV file once
    const audioArrayBuffer = await audioFile.arrayBuffer();
    console.log(`WAV file size: ${audioArrayBuffer.byteLength} bytes`);

    // Extract samples for compression
    const int16Data = extractInt16Samples(audioArrayBuffer);
    let compressedWav: Uint8Array | null = null;
    let snrDb: number | null = null;
    let qualityStatus = 'pending';

    if (int16Data) {
      console.log(`Creating compressed WAV: ${int16Data.leftChannel.length} samples, ${int16Data.sampleRate}Hz`);
      compressedWav = createCompressedWav(int16Data.leftChannel, int16Data.rightChannel, int16Data.sampleRate);
      console.log(`Compressed WAV size: ${compressedWav.byteLength} bytes (${((1 - compressedWav.byteLength / audioArrayBuffer.byteLength) * 100).toFixed(1)}% reduction)`);

      // Parse compressed WAV for SNR analysis
      const compressedBuffer = compressedWav.buffer.slice(0) as ArrayBuffer;
      const parsedCompressed = parseWavFile(compressedBuffer);
      if (parsedCompressed) {
        snrDb = calculateSNR(parsedCompressed.samples, parsedCompressed.sampleRate);
        qualityStatus = snrDb >= 20 ? 'passed' : 'failed';
        console.log(`Audio quality analysis on compressed: SNR = ${snrDb} dB, Status = ${qualityStatus}`);
      } else {
        console.warn('Could not parse compressed WAV for SNR analysis');
        qualityStatus = 'error';
      }
    } else {
      console.warn('Could not extract samples from WAV for compression');
      qualityStatus = 'error';
    }

    // Generate unique filenames
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = metadata.filename?.replace(/\.wav$/i, '') || 'recording';
    const wavFilename = `${metadata.discord_guild_id}/${metadata.discord_user_id}/${timestamp}_${baseFilename}.wav`;
    const compressedFilename = `${metadata.discord_guild_id}/${metadata.discord_user_id}/${timestamp}_${baseFilename}_compressed.wav`;

    // Upload original WAV
    console.log('Uploading original WAV...');
    const { data: wavUploadData, error: wavUploadError } = await supabase.storage
      .from('voice-recordings')
      .upload(wavFilename, new Blob([audioArrayBuffer], { type: 'audio/wav' }), {
        contentType: 'audio/wav',
        upsert: false
      });

    if (wavUploadError) {
      console.error('Storage upload error (WAV):', wavUploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload WAV file', details: wavUploadError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get WAV public URL
    const { data: { publicUrl: wavPublicUrl } } = supabase.storage
      .from('voice-recordings')
      .getPublicUrl(wavFilename);

    // Upload compressed WAV for analysis/transcription
    let compressedPublicUrl: string | null = null;
    if (compressedWav) {
      console.log('Uploading compressed WAV...');
      const compressedBlobBuffer = compressedWav.buffer.slice(0) as ArrayBuffer;
      const { error: compressedUploadError } = await supabase.storage
        .from('voice-recordings')
        .upload(compressedFilename, new Blob([new Uint8Array(compressedBlobBuffer)], { type: 'audio/wav' }), {
          contentType: 'audio/wav',
          upsert: false
        });

      if (compressedUploadError) {
        console.error('Storage upload error (compressed):', compressedUploadError);
        // Continue without compressed version
      } else {
        const { data: { publicUrl } } = supabase.storage
          .from('voice-recordings')
          .getPublicUrl(compressedFilename);
        compressedPublicUrl = publicUrl;
        console.log('Compressed WAV uploaded successfully');
      }
    }

    // Insert record into database with both URLs
    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id: metadata.discord_guild_id,
        discord_guild_name: metadata.discord_guild_name,
        discord_channel_id: metadata.discord_channel_id,
        discord_channel_name: metadata.discord_channel_name,
        discord_user_id: metadata.discord_user_id,
        discord_username: metadata.discord_username,
        filename: wavFilename,
        file_url: wavPublicUrl,
        mp3_file_url: compressedPublicUrl, // Use compressed URL for transcription
        file_size_bytes: audioFile.size,
        duration_seconds: metadata.duration_seconds,
        sample_rate: 48000,
        bit_depth: 16,
        channels: 2,
        format: 'wav',
        status: 'completed',
        snr_db: snrDb,
        quality_status: qualityStatus,
        topic_id: metadata.topic_id || null,
        language: metadata.language || null,
        campaign_id: metadata.campaign_id || null,
        metadata: metadata.extra || {},
        transcription_status: 'pending'
      })
      .select()
      .single();

    if (recordError) {
      console.error('Database insert error:', recordError);
      return new Response(
        JSON.stringify({ error: 'Failed to save recording metadata', details: recordError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Recording uploaded successfully:', {
      id: recordData.id,
      snr_db: snrDb,
      quality_status: qualityStatus,
      wav_url: wavPublicUrl,
      compressed_url: compressedPublicUrl
    });

    // DISABLED: Transcription is now on-demand only (cost optimization)
    // const transcribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe-audio`;
    // const audioUrlForTranscription = compressedPublicUrl || wavPublicUrl;
    console.log(`Transcription skipped for ${recordData.id} (on-demand only)`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        recording: recordData,
        file_url: wavPublicUrl,
        compressed_url: compressedPublicUrl,
        quality: {
          snr_db: snrDb,
          status: qualityStatus,
          passed: qualityStatus === 'passed'
        },
        transcription: {
          status: 'pending',
          message: 'Transcription started in background',
          using_compressed: !!compressedPublicUrl
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
