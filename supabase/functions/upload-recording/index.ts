import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-api-key',
};

// Parse WAV file and extract PCM samples
function parseWavFile(arrayBuffer: ArrayBuffer): { samples: Float32Array; sampleRate: number; channels: number } | null {
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
  
  return { samples, sampleRate, channels };
}

// Calculate RMS (Root Mean Square) of samples
function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

// Estimate noise floor using the quietest segments
function estimateNoiseFloor(samples: Float32Array, sampleRate: number): number {
  // Use 50ms windows
  const windowSize = Math.floor(sampleRate * 0.05);
  const numWindows = Math.floor(samples.length / windowSize);
  
  if (numWindows < 10) {
    // Too short, use bottom 10% of overall signal
    const sortedAbs = Array.from(samples).map(Math.abs).sort((a, b) => a - b);
    const bottomCount = Math.floor(sortedAbs.length * 0.1);
    if (bottomCount === 0) return 0.0001;
    
    let sum = 0;
    for (let i = 0; i < bottomCount; i++) {
      sum += sortedAbs[i] * sortedAbs[i];
    }
    return Math.sqrt(sum / bottomCount);
  }
  
  // Calculate RMS for each window
  const windowRMS: number[] = [];
  for (let i = 0; i < numWindows; i++) {
    const start = i * windowSize;
    const windowSamples = samples.slice(start, start + windowSize);
    windowRMS.push(calculateRMS(windowSamples));
  }
  
  // Sort and take the average of the quietest 10% of windows
  windowRMS.sort((a, b) => a - b);
  const quietWindowCount = Math.max(1, Math.floor(numWindows * 0.1));
  
  let noiseSum = 0;
  for (let i = 0; i < quietWindowCount; i++) {
    noiseSum += windowRMS[i];
  }
  
  const noiseFloor = noiseSum / quietWindowCount;
  return noiseFloor > 0 ? noiseFloor : 0.0001; // Prevent division by zero
}

// Calculate SNR in dB
function calculateSNR(samples: Float32Array, sampleRate: number): number {
  const signalRMS = calculateRMS(samples);
  const noiseFloor = estimateNoiseFloor(samples, sampleRate);
  
  if (noiseFloor === 0 || signalRMS === 0) {
    return 0;
  }
  
  const snr = 20 * Math.log10(signalRMS / noiseFloor);
  return Math.round(snr * 10) / 10; // Round to 1 decimal place
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

    // Read audio file for SNR analysis
    const audioArrayBuffer = await audioFile.arrayBuffer();
    
    // Calculate SNR
    let snrDb: number | null = null;
    let qualityStatus = 'pending';
    
    try {
      const parsedWav = parseWavFile(audioArrayBuffer);
      if (parsedWav) {
        snrDb = calculateSNR(parsedWav.samples, parsedWav.sampleRate);
        qualityStatus = snrDb >= 20 ? 'passed' : 'failed';
        console.log(`Audio quality analysis: SNR = ${snrDb} dB, Status = ${qualityStatus}`);
      } else {
        console.warn('Could not parse WAV file for SNR analysis');
        qualityStatus = 'error';
      }
    } catch (snrError) {
      console.error('SNR calculation error:', snrError);
      qualityStatus = 'error';
    }

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueFilename = `${metadata.discord_guild_id}/${metadata.discord_user_id}/${timestamp}_${metadata.filename || 'recording.wav'}`;

    // Upload to storage (convert ArrayBuffer back to Blob)
    const audioBlob = new Blob([audioArrayBuffer], { type: 'audio/wav' });
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('voice-recordings')
      .upload(uniqueFilename, audioBlob, {
        contentType: 'audio/wav',
        upsert: false
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload file', details: uploadError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('voice-recordings')
      .getPublicUrl(uniqueFilename);

    // Insert record into database with SNR data
    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id: metadata.discord_guild_id,
        discord_guild_name: metadata.discord_guild_name,
        discord_channel_id: metadata.discord_channel_id,
        discord_channel_name: metadata.discord_channel_name,
        discord_user_id: metadata.discord_user_id,
        discord_username: metadata.discord_username,
        filename: uniqueFilename,
        file_url: publicUrl,
        file_size_bytes: audioFile.size,
        duration_seconds: metadata.duration_seconds,
        sample_rate: 48000,
        bit_depth: 16,
        channels: 2,
        format: 'wav',
        status: 'completed',
        snr_db: snrDb,
        quality_status: qualityStatus,
        metadata: metadata.extra || {}
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
      quality_status: qualityStatus
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        recording: recordData,
        file_url: publicUrl,
        quality: {
          snr_db: snrDb,
          status: qualityStatus,
          passed: qualityStatus === 'passed'
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