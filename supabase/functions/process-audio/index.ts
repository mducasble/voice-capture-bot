import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
// @ts-ignore - lamejs works in Deno via esm.sh
import lamejs from "https://esm.sh/lamejs@1.2.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const TARGET_SAMPLE_RATE = 16000;
const CHUNK_DURATION_SECONDS = 300; // 5 minutes per chunk
const SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE * CHUNK_DURATION_SECONDS;
const MP3_BITRATE = 64; // kbps - good for speech

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

// Encode PCM samples to MP3
function encodeToMp3(samples: Int16Array, sampleRate: number): Uint8Array {
  const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, MP3_BITRATE);
  const mp3Data: Uint8Array[] = [];
  
  const blockSize = 1152;
  for (let i = 0; i < samples.length; i += blockSize) {
    const chunk = samples.subarray(i, Math.min(i + blockSize, samples.length));
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }
  
  const end = mp3encoder.flush();
  if (end.length > 0) {
    mp3Data.push(new Uint8Array(end));
  }
  
  // Combine all MP3 data
  const totalLength = mp3Data.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
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

    const { recording_id, audio_url } = await req.json();

    if (!recording_id || !audio_url) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id or audio_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing audio for recording ${recording_id}`);

    // Update status to processing
    await supabase.from('voice_recordings').update({ status: 'processing' }).eq('id', recording_id);

    // Fetch audio with streaming
    const audioResponse = await fetch(audio_url);
    if (!audioResponse.ok || !audioResponse.body) {
      throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
    }

    const reader = audioResponse.body.getReader();
    const headerChunk = await reader.read();
    if (!headerChunk.value) {
      throw new Error('Empty audio file');
    }

    const header = parseWavHeader(headerChunk.value);
    if (!header) {
      throw new Error('Invalid WAV file');
    }

    console.log(`Audio: ${header.sampleRate}Hz, ${header.channels}ch, ${header.bitsPerSample}bit`);

    // Process audio: stream, downsample, chunk, encode to MP3
    const ratio = header.sampleRate / TARGET_SAMPLE_RATE;
    const bytesPerFrame = header.channels * (header.bitsPerSample / 8);
    
    let bytesToSkip = header.dataOffset;
    let partialFrame = new Uint8Array(0);
    let srcIdx = 0;
    let outputSampleIdx = 0;
    
    // Current chunk samples
    let chunkSamples: number[] = [];
    let chunkIndex = 0;
    const uploadedChunks: { url: string; index: number }[] = [];
    
    // SNR calculation from first 5 seconds
    const snrSamples: number[] = [];
    const snrSampleTarget = TARGET_SAMPLE_RATE * 5;
    
    let currentValue = headerChunk.value;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Helper to finalize and upload a chunk
    const finalizeChunk = async () => {
      if (chunkSamples.length === 0) return;
      
      console.log(`Encoding chunk ${chunkIndex} with ${chunkSamples.length} samples`);
      
      const samples = new Int16Array(chunkSamples);
      const mp3Data = encodeToMp3(samples, TARGET_SAMPLE_RATE);
      
      console.log(`Chunk ${chunkIndex}: ${samples.length} samples -> ${(mp3Data.length / 1024).toFixed(1)} KB MP3`);
      
      const chunkPath = `chunks/${recording_id}_${timestamp}_chunk${String(chunkIndex).padStart(3, '0')}.mp3`;
      
      const { error: uploadError } = await supabase.storage
        .from('voice-recordings')
        .upload(chunkPath, mp3Data, {
          contentType: 'audio/mpeg',
          upsert: true
        });
      
      if (uploadError) {
        console.error(`Failed to upload chunk ${chunkIndex}:`, uploadError);
        throw uploadError;
      }
      
      const { data: { publicUrl } } = supabase.storage
        .from('voice-recordings')
        .getPublicUrl(chunkPath);
      
      uploadedChunks.push({ url: publicUrl, index: chunkIndex });
      console.log(`Uploaded chunk ${chunkIndex}: ${publicUrl}`);
      
      chunkSamples = [];
      chunkIndex++;
    };

    // Stream and process audio
    while (true) {
      let chunkStart = 0;
      
      // Skip WAV header bytes
      if (bytesToSkip > 0) {
        if (currentValue.length <= bytesToSkip) {
          bytesToSkip -= currentValue.length;
          const nextRead = await reader.read();
          if (nextRead.done) break;
          currentValue = nextRead.value!;
          continue;
        }
        chunkStart = bytesToSkip;
        bytesToSkip = 0;
      }

      // Combine with partial frame from previous iteration
      let dataToProcess: Uint8Array;
      if (partialFrame.length > 0) {
        dataToProcess = new Uint8Array(partialFrame.length + currentValue.length - chunkStart);
        dataToProcess.set(partialFrame);
        dataToProcess.set(currentValue.subarray(chunkStart), partialFrame.length);
      } else {
        dataToProcess = currentValue.subarray(chunkStart);
      }

      // Process complete frames
      const view = new DataView(dataToProcess.buffer, dataToProcess.byteOffset, dataToProcess.byteLength);
      let frameOffset = 0;

      while (frameOffset + bytesPerFrame <= dataToProcess.length) {
        const targetOutputIdx = Math.floor(srcIdx / ratio);

        if (targetOutputIdx > outputSampleIdx) {
          // Mix channels to mono
          let sample = 0;
          for (let ch = 0; ch < header.channels; ch++) {
            sample += view.getInt16(frameOffset + ch * 2, true);
          }
          const monoSample = Math.round(sample / header.channels);
          
          chunkSamples.push(monoSample);
          outputSampleIdx++;

          // Collect SNR samples
          if (snrSamples.length < snrSampleTarget) {
            snrSamples.push(monoSample);
          }

          // Check if chunk is complete
          if (chunkSamples.length >= SAMPLES_PER_CHUNK) {
            await finalizeChunk();
          }
        }

        srcIdx++;
        frameOffset += bytesPerFrame;
      }

      // Save partial frame for next iteration
      partialFrame = new Uint8Array(dataToProcess.subarray(frameOffset));

      // Read next chunk from stream
      const nextRead = await reader.read();
      if (nextRead.done) break;
      currentValue = nextRead.value!;
    }

    // Finalize last chunk
    await finalizeChunk();

    // Calculate SNR
    const snrDb = snrSamples.length > 0 ? calculateSNR(new Int16Array(snrSamples)) : null;
    const qualityStatus = snrDb !== null ? (snrDb >= 20 ? 'passed' : 'failed') : 'error';
    
    console.log(`Processing complete: ${uploadedChunks.length} chunks, SNR=${snrDb}dB`);

    // Update recording with first chunk URL and SNR
    const { error: updateError } = await supabase
      .from('voice_recordings')
      .update({
        mp3_file_url: uploadedChunks[0]?.url || null,
        snr_db: snrDb,
        quality_status: qualityStatus,
        status: 'completed'
      })
      .eq('id', recording_id);

    if (updateError) {
      console.error('Failed to update recording:', updateError);
      throw updateError;
    }

    // Background: Transcribe all chunks and combine
    const transcribeChunks = async () => {
      try {
        const transcribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe-audio`;
        const transcriptions: string[] = [];
        let detectedLanguage: string | null = null;

        await supabase.from('voice_recordings')
          .update({ transcription_status: 'processing' })
          .eq('id', recording_id);

        for (const chunk of uploadedChunks) {
          console.log(`Transcribing chunk ${chunk.index}...`);
          
          const chunkRes: Response = await fetch(transcribeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({
              recording_id: `${recording_id}_chunk_${chunk.index}`, // Fake ID to prevent DB update
              audio_url: chunk.url,
              language: detectedLanguage // Use detected language for subsequent chunks
            })
          });

          if (chunkRes.ok) {
            const chunkData: { transcription?: string; detected_language?: string } = await chunkRes.json();
            if (chunkData.transcription) {
              transcriptions.push(chunkData.transcription);
            }
            if (!detectedLanguage && chunkData.detected_language) {
              detectedLanguage = chunkData.detected_language;
            }
            console.log(`Chunk ${chunk.index} transcribed: ${chunkData.transcription?.length || 0} chars`);
          } else {
            console.error(`Chunk ${chunk.index} transcription failed:`, await chunkRes.text());
          }
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
    };

    // @ts-ignore - EdgeRuntime available in Supabase Edge Functions
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(transcribeChunks());
    } else {
      await transcribeChunks();
    }

    return new Response(
      JSON.stringify({
        success: true,
        recording_id,
        chunks: uploadedChunks.length,
        snr_db: snrDb,
        quality_status: qualityStatus
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
