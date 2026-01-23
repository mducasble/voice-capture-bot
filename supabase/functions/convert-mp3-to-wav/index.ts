// @ts-nocheck - External WASM modules have limited type support
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PCM audio parameters for output WAV
const OUTPUT_SAMPLE_RATE = 48000;
const OUTPUT_CHANNELS = 2;
const OUTPUT_BITS_PER_SAMPLE = 16;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mp3_url, filename, sample_rate, channels } = await req.json();

    if (!mp3_url) {
      return new Response(
        JSON.stringify({ error: 'mp3_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use custom output parameters if provided
    const outputSampleRate = sample_rate || OUTPUT_SAMPLE_RATE;
    const outputChannels = channels || OUTPUT_CHANNELS;

    console.log(`Fetching MP3 from: ${mp3_url}`);

    // Fetch the MP3 file
    const mp3Response = await fetch(mp3_url);
    if (!mp3Response.ok) {
      throw new Error(`Failed to fetch MP3: ${mp3Response.status} ${mp3Response.statusText}`);
    }

    const mp3Buffer = await mp3Response.arrayBuffer();
    console.log(`MP3 file size: ${mp3Buffer.byteLength} bytes`);

    console.log('Decoding MP3...');
    
    // Dynamic import of mpg123-decoder
    const { MPEGDecoderWebWorker } = await import("https://esm.sh/mpg123-decoder@0.4.12");
    
    const decoder = new MPEGDecoderWebWorker();
    await decoder.ready;

    const decoded = await decoder.decode(new Uint8Array(mp3Buffer));
    await decoder.free();
    
    if (!decoded || !decoded.channelData || decoded.channelData.length === 0) {
      throw new Error('Failed to decode MP3');
    }

    const inputSampleRate = decoded.sampleRate;
    const inputChannels = decoded.channelData.length;
    const inputSamples = decoded.samplesDecoded;

    console.log(`Decoded: ${inputSamples} samples, ${inputSampleRate}Hz, ${inputChannels} channels`);

    // Calculate output samples after resampling
    const resampleRatio = outputSampleRate / inputSampleRate;
    const outputSamples = Math.floor(inputSamples * resampleRatio);

    // Create interleaved PCM buffer
    const bytesPerSample = OUTPUT_BITS_PER_SAMPLE / 8;
    const pcmDataSize = outputSamples * outputChannels * bytesPerSample;
    const pcmData = new ArrayBuffer(pcmDataSize);
    const pcmView = new DataView(pcmData);

    console.log(`Resampling from ${inputSampleRate}Hz to ${outputSampleRate}Hz...`);
    console.log(`Output: ${outputSamples} samples, ${outputChannels} channels`);

    // Simple linear interpolation resampling
    for (let i = 0; i < outputSamples; i++) {
      const srcPos = i / resampleRatio;
      const srcIndex = Math.floor(srcPos);
      const frac = srcPos - srcIndex;
      const nextIndex = Math.min(srcIndex + 1, inputSamples - 1);

      for (let ch = 0; ch < outputChannels; ch++) {
        // Use modulo to handle mono -> stereo conversion
        const srcCh = ch % inputChannels;
        const channelData = decoded.channelData[srcCh];

        // Linear interpolation
        const sample1 = channelData[srcIndex] || 0;
        const sample2 = channelData[nextIndex] || 0;
        const interpolated = sample1 + (sample2 - sample1) * frac;

        // Convert float [-1, 1] to 16-bit signed integer
        const intSample = Math.max(-32768, Math.min(32767, Math.round(interpolated * 32767)));
        
        const offset = (i * outputChannels + ch) * bytesPerSample;
        pcmView.setInt16(offset, intSample, true); // little-endian
      }
    }

    console.log('Creating WAV file...');

    // Create WAV header
    const wavBuffer = createWavFile(pcmData, outputSampleRate, outputChannels, OUTPUT_BITS_PER_SAMPLE);

    console.log(`WAV file size: ${wavBuffer.byteLength} bytes`);

    // Generate filename
    const outputFilename = filename || 'converted.wav';

    return new Response(wavBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${outputFilename}"`,
        'Content-Length': wavBuffer.byteLength.toString(),
      },
    });

  } catch (err) {
    const error = err as Error;
    console.error('Error converting MP3 to WAV:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function createWavFile(
  pcmData: ArrayBuffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): ArrayBuffer {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.byteLength;

  // WAV header is 44 bytes
  const headerSize = 44;
  const wavBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(wavBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1 size (16 for PCM)
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Copy PCM data
  const wavArray = new Uint8Array(wavBuffer);
  const pcmArray = new Uint8Array(pcmData);
  wavArray.set(pcmArray, headerSize);

  return wavBuffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
