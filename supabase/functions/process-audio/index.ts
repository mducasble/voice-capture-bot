import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Parse WAV header to get audio info (without loading all samples)
function parseWavHeader(headerBytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number } | null {
  if (headerBytes.length < 44) return null;
  
  const view = new DataView(headerBytes.buffer);
  
  // Check RIFF header
  const riff = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);
  if (riff !== 'RIFF') return null;
  
  // Check WAVE format
  const wave = String.fromCharCode(headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]);
  if (wave !== 'WAVE') return null;
  
  // Find fmt chunk
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

// Create compressed WAV header
function createWavHeader(dataSize: number, sampleRate: number = 16000): Uint8Array {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Downsample audio in streaming fashion (chunk by chunk)
async function* downsampleStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number },
  targetSampleRate: number = 16000
): AsyncGenerator<Uint8Array> {
  const ratio = header.sampleRate / targetSampleRate;
  const bytesPerFrame = header.channels * (header.bitsPerSample / 8);
  
  let bytesToSkip = header.dataOffset;
  let srcSampleIndex = 0;
  let buffer = new Uint8Array(0);
  let outputSamples: number[] = [];
  const outputChunkSize = 32000; // Output ~32KB chunks
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    // Skip header bytes
    let chunkStart = 0;
    if (bytesToSkip > 0) {
      if (value.length <= bytesToSkip) {
        bytesToSkip -= value.length;
        continue;
      }
      chunkStart = bytesToSkip;
      bytesToSkip = 0;
    }
    
    // Combine with previous incomplete frame
    const newBuffer = new Uint8Array(buffer.length + value.length - chunkStart);
    newBuffer.set(buffer);
    newBuffer.set(value.subarray(chunkStart), buffer.length);
    buffer = newBuffer;
    
    // Process complete frames
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    let frameOffset = 0;
    
    while (frameOffset + bytesPerFrame <= buffer.length) {
      // Calculate which output sample this maps to
      const outputSampleIndex = Math.floor(srcSampleIndex / ratio);
      
      if (outputSampleIndex >= outputSamples.length) {
        // Mix to mono
        let sample = 0;
        for (let ch = 0; ch < header.channels; ch++) {
          sample += view.getInt16(frameOffset + ch * 2, true);
        }
        outputSamples.push(Math.round(sample / header.channels));
        
        // Yield chunk when large enough
        if (outputSamples.length >= outputChunkSize / 2) {
          const outputBuffer = new ArrayBuffer(outputSamples.length * 2);
          const outputView = new DataView(outputBuffer);
          for (let i = 0; i < outputSamples.length; i++) {
            outputView.setInt16(i * 2, outputSamples[i], true);
          }
          yield new Uint8Array(outputBuffer);
          outputSamples = [];
        }
      }
      
      srcSampleIndex++;
      frameOffset += bytesPerFrame;
    }
    
    // Keep incomplete frame for next iteration
    if (frameOffset < buffer.length) {
      buffer = buffer.slice(frameOffset);
    } else {
      buffer = new Uint8Array(0);
    }
  }
  
  // Yield remaining samples
  if (outputSamples.length > 0) {
    const outputBuffer = new ArrayBuffer(outputSamples.length * 2);
    const outputView = new DataView(outputBuffer);
    for (let i = 0; i < outputSamples.length; i++) {
      outputView.setInt16(i * 2, outputSamples[i], true);
    }
    yield new Uint8Array(outputBuffer);
  }
}

// Calculate SNR from a sample of audio
function calculateSNRFromSample(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  
  // Convert to float
  const floatSamples = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    floatSamples[i] = samples[i] / 32768.0;
  }
  
  // Calculate signal RMS
  let sum = 0;
  for (let i = 0; i < floatSamples.length; i++) {
    sum += floatSamples[i] * floatSamples[i];
  }
  const signalRMS = Math.sqrt(sum / floatSamples.length);
  
  // Estimate noise floor using bottom 10%
  const sorted = Array.from(floatSamples).map(Math.abs).sort((a, b) => a - b);
  const bottomCount = Math.max(1, Math.floor(sorted.length * 0.1));
  let noiseSum = 0;
  for (let i = 0; i < bottomCount; i++) {
    noiseSum += sorted[i] * sorted[i];
  }
  const noiseFloor = Math.sqrt(noiseSum / bottomCount) || 0.0001;
  
  const snr = 20 * Math.log10(signalRMS / noiseFloor);
  return Math.round(snr * 10) / 10;
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

    // Fetch audio with streaming
    const audioResponse = await fetch(audio_url);
    if (!audioResponse.ok || !audioResponse.body) {
      throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
    }

    // Read header first
    const reader = audioResponse.body.getReader();
    const headerChunk = await reader.read();
    if (!headerChunk.value) {
      throw new Error('Empty audio file');
    }

    const header = parseWavHeader(headerChunk.value);
    if (!header) {
      throw new Error('Invalid WAV file');
    }

    console.log(`Audio info: ${header.sampleRate}Hz, ${header.channels}ch, ${header.bitsPerSample}bit`);

    // Collect samples for SNR calculation (first ~5 seconds)
    const snrSampleTarget = header.sampleRate * 5; // 5 seconds
    const snrSamples: number[] = [];
    let snrDb: number | null = null;

    // Create compressed audio stream
    const targetSampleRate = 16000;
    const compressedChunks: Uint8Array[] = [];
    let totalCompressedBytes = 0;
    const maxCompressedSize = 5 * 1024 * 1024; // 5MB limit (~2.5 min at 16kHz mono) for transcription memory limits
    
    // Restore the first chunk to the stream
    const firstChunk = headerChunk.value;
    const combinedReader = {
      read: async () => {
        if (firstChunk) {
          const chunk = firstChunk;
          (combinedReader as { firstRead: boolean }).firstRead = true;
          return { done: false, value: chunk };
        }
        return reader.read();
      },
      firstRead: false
    };

    // Process audio in streaming fashion
    let srcIdx = 0;
    const ratio = header.sampleRate / targetSampleRate;
    let bytesToSkip = header.dataOffset;
    let partialFrame = new Uint8Array(0);
    const bytesPerFrame = header.channels * (header.bitsPerSample / 8);
    let outputSampleIdx = 0;
    const outputBuffer: number[] = [];

    // Read first chunk
    let currentValue = firstChunk;
    let isFirst = true;

    while (true) {
      let chunkStart = 0;
      
      // Skip header bytes
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

      // Combine with partial frame from previous chunk
      let dataToProcess: Uint8Array;
      if (partialFrame.length > 0) {
        dataToProcess = new Uint8Array(partialFrame.length + currentValue.length - chunkStart);
        dataToProcess.set(partialFrame);
        dataToProcess.set(currentValue.subarray(chunkStart), partialFrame.length);
      } else {
        dataToProcess = currentValue.subarray(chunkStart);
      }

      // Process complete frames
      const view = new DataView(dataToProcess.buffer, dataToProcess.byteOffset);
      let frameOffset = 0;

      while (frameOffset + bytesPerFrame <= dataToProcess.length) {
        // Calculate output sample position
        const targetOutputIdx = Math.floor(srcIdx / ratio);

        if (targetOutputIdx > outputSampleIdx) {
          // Mix to mono
          let sample = 0;
          for (let ch = 0; ch < header.channels; ch++) {
            sample += view.getInt16(frameOffset + ch * 2, true);
          }
          const monoSample = Math.round(sample / header.channels);
          outputBuffer.push(monoSample);
          outputSampleIdx++;

          // Collect samples for SNR (first 5 seconds)
          if (snrSamples.length < snrSampleTarget) {
            snrSamples.push(monoSample);
          }

          // Write output in 64KB chunks
          if (outputBuffer.length >= 32000) {
            const chunkData = new ArrayBuffer(outputBuffer.length * 2);
            const chunkView = new DataView(chunkData);
            for (let i = 0; i < outputBuffer.length; i++) {
              chunkView.setInt16(i * 2, outputBuffer[i], true);
            }
            const chunk = new Uint8Array(chunkData);
            compressedChunks.push(chunk);
            totalCompressedBytes += chunk.length;
            outputBuffer.length = 0;

            if (totalCompressedBytes > maxCompressedSize) {
              console.warn('Compressed audio exceeds size limit, truncating');
              break;
            }
          }
        }

        srcIdx++;
        frameOffset += bytesPerFrame;
      }

      if (totalCompressedBytes > maxCompressedSize) break;

      // Save partial frame
      partialFrame = new Uint8Array(dataToProcess.subarray(frameOffset));

      // Read next chunk
      const nextRead = await reader.read();
      if (nextRead.done) break;
      currentValue = nextRead.value!;
    }

    // Flush remaining samples
    if (outputBuffer.length > 0 && totalCompressedBytes < maxCompressedSize) {
      const chunkData = new ArrayBuffer(outputBuffer.length * 2);
      const chunkView = new DataView(chunkData);
      for (let i = 0; i < outputBuffer.length; i++) {
        chunkView.setInt16(i * 2, outputBuffer[i], true);
      }
      compressedChunks.push(new Uint8Array(chunkData));
      totalCompressedBytes += outputBuffer.length * 2;
    }

    // Calculate SNR
    if (snrSamples.length > 0) {
      snrDb = calculateSNRFromSample(new Int16Array(snrSamples));
      console.log(`SNR calculated: ${snrDb} dB (from ${snrSamples.length} samples)`);
    }

    // Combine compressed chunks with header
    const wavHeader = createWavHeader(totalCompressedBytes, targetSampleRate);
    const finalSize = wavHeader.length + totalCompressedBytes;
    const compressedAudio = new Uint8Array(finalSize);
    compressedAudio.set(wavHeader);
    let offset = wavHeader.length;
    for (const chunk of compressedChunks) {
      compressedAudio.set(chunk, offset);
      offset += chunk.length;
    }

    console.log(`Compressed audio: ${(finalSize / 1024 / 1024).toFixed(2)} MB`);

    // Upload compressed audio
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const compressedPath = `compressed/${recording_id}_${timestamp}.wav`;

    const { error: uploadError } = await supabase.storage
      .from('voice-recordings')
      .upload(compressedPath, compressedAudio, {
        contentType: 'audio/wav',
        upsert: true
      });

    if (uploadError) {
      console.error('Failed to upload compressed audio:', uploadError);
      throw uploadError;
    }

    const { data: { publicUrl: compressedUrl } } = supabase.storage
      .from('voice-recordings')
      .getPublicUrl(compressedPath);

    // Update recording with compressed URL and SNR
    const qualityStatus = snrDb !== null ? (snrDb >= 20 ? 'passed' : 'failed') : 'error';
    
    const { error: updateError } = await supabase
      .from('voice_recordings')
      .update({
        mp3_file_url: compressedUrl,
        snr_db: snrDb,
        quality_status: qualityStatus
      })
      .eq('id', recording_id);

    if (updateError) {
      console.error('Failed to update recording:', updateError);
      throw updateError;
    }

    console.log(`Audio processed: SNR=${snrDb}dB, compressed=${(finalSize/1024/1024).toFixed(2)}MB`);

    // Trigger transcription with compressed URL using waitUntil for background processing
    const transcribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe-audio`;
    
    const triggerTranscription = async () => {
      try {
        const res = await fetch(transcribeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            recording_id,
            audio_url: compressedUrl,
            language: null // Auto-detect
          })
        });
        console.log(`Transcription triggered, status: ${res.status}`);
        if (!res.ok) {
          const errText = await res.text();
          console.error(`Transcription error response: ${errText.substring(0, 500)}`);
        }
      } catch (err) {
        console.error('Failed to trigger transcription:', err);
      }
    };

    // Use EdgeRuntime.waitUntil to ensure the transcription call completes
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(triggerTranscription());
    } else {
      // Fallback: await the call directly (blocks response but ensures it runs)
      await triggerTranscription();
    }

    return new Response(
      JSON.stringify({
        success: true,
        recording_id,
        compressed_url: compressedUrl,
        compressed_size: finalSize,
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
