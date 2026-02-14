import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Thresholds for pass/fail
const THRESHOLDS = {
  snr: { good: 25, fair: 15 },
  rms: { min: -26, max: -20 },
  srmr: { good: 6, fair: 10 },
  wvmos: { good: 1.5, fair: 2.5 },
  utmos: { good: 3.5, fair: 2.5 },
  sigmos_ovrl: { good: 2.8, fair: 2.5 },
  sigmos_disc: { good: 3.5, fair: 2.5 },
  sigmos_reverb: { good: 3.5, fair: 2.5 },
  vqscore: { good: 0.65, fair: 60 },
  mic_sr: { good: 16000, fair: 8000 },
};

// Guidance messages for each metric when it fails
const GUIDANCE: Record<string, { low: string; high?: string }> = {
  snr: {
    low: "Seu ambiente está muito barulhento. Tente gravar em um local mais silencioso, feche janelas/portas e desligue ventiladores ou ar-condicionado.",
  },
  rms: {
    low: "O volume do seu microfone está muito baixo. Fale mais perto do microfone ou aumente o ganho nas configurações do sistema.",
    high: "O volume está muito alto e pode causar distorção. Afaste-se um pouco do microfone ou reduza o ganho.",
  },
  srmr: {
    low: "Há muita reverberação (eco) no seu ambiente. Tente gravar em um espaço menor ou com materiais que absorvam som (cortinas, carpete).",
  },
  wvmos: {
    low: "A qualidade geral da voz está abaixo do esperado. Verifique se o microfone está funcionando corretamente e se não há interferências.",
  },
  utmos: {
    low: "A naturalidade da fala está comprometida. Tente falar em um tom mais natural e consistente.",
  },
  sigmos_ovrl: {
    low: "A qualidade geral do sinal está baixa. Verifique conexões do microfone e tente um dispositivo diferente.",
  },
  sigmos_disc: {
    low: "Há distorção no áudio. Reduza o volume de entrada ou afaste-se do microfone.",
  },
  sigmos_reverb: {
    low: "Reverberação excessiva detectada. Use um ambiente mais tratado acusticamente.",
  },
  vqscore: {
    low: "O score de qualidade de voz está baixo. Melhore o ambiente e verifique o equipamento.",
  },
  mic_sr: {
    low: "Seu microfone tem largura de banda limitada. Use um microfone de melhor qualidade se possível (headset USB ou condensador).",
  },
};

// Parse WAV header
function parseWavHeader(headerBytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number } | null {
  if (headerBytes.length < 44) return null;
  const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  const riff = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);
  if (riff !== 'RIFF') return null;
  const wave = String.fromCharCode(headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]);
  if (wave !== 'WAVE') return null;

  let offset = 12;
  let sampleRate = 48000, channels = 2, bitsPerSample = 16, dataOffset = 0, dataSize = 0;

  while (offset < Math.min(headerBytes.length - 8, 1000)) {
    const chunkId = String.fromCharCode(headerBytes[offset], headerBytes[offset + 1], headerBytes[offset + 2], headerBytes[offset + 3]);
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

// Downsample to 16kHz mono Int16Array
function downsampleToMono16k(audioBytes: Uint8Array, header: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number }): Int16Array {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = header;
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / (bytesPerSample * channels));
  const view = new DataView(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength);

  const TARGET_SR = 16000;
  const ratio = TARGET_SR / sampleRate;
  const outputLen = Math.floor(totalSamples * ratio);
  const result = new Int16Array(outputLen);

  for (let i = 0; i < outputLen; i++) {
    const srcIdx = Math.floor(i / ratio);
    let mono = 0;
    for (let ch = 0; ch < channels; ch++) {
      const bytePos = dataOffset + (srcIdx * channels + ch) * bytesPerSample;
      if (bytesPerSample === 2) {
        mono += view.getInt16(bytePos, true);
      } else if (bytesPerSample === 3) {
        const b0 = audioBytes[bytePos], b1 = audioBytes[bytePos + 1], b2 = audioBytes[bytePos + 2];
        let val = (b2 << 16) | (b1 << 8) | b0;
        if (val & 0x800000) val |= ~0xFFFFFF;
        mono += Math.round(val / 256);
      }
    }
    result[i] = Math.max(-32768, Math.min(32767, Math.round(mono / channels)));
  }
  return result;
}

// VAD
function detectSpeechRegions(samples: Int16Array, sampleRate: number) {
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
      const s = samples[start + i] / 32768.0;
      energy += s * s;
    }
    energies.push(energy / windowSize);
  }

  const sorted = [...energies].sort((a, b) => a - b);
  const nfIdx = Math.floor(sorted.length * 0.2);
  let nfE = 0;
  for (let i = 0; i < nfIdx; i++) nfE += sorted[i];
  nfE = nfIdx > 0 ? nfE / nfIdx : 0.0001;
  const threshold = Math.max(nfE * 3, 0.0001);

  const regions: { start: number; end: number }[] = [];
  let inSpeech = false, regionStart = 0, regionCount = 0, hangover = 0;
  const minWindows = 5, hangoverWindows = 10;

  for (let w = 0; w < numWindows; w++) {
    const above = energies[w] > threshold;
    if (!inSpeech && above) {
      inSpeech = true; regionStart = w * hopSize; regionCount = 1; hangover = hangoverWindows;
    } else if (inSpeech) {
      if (above) { regionCount++; hangover = hangoverWindows; }
      else { hangover--; if (hangover <= 0) { if (regionCount >= minWindows) regions.push({ start: regionStart, end: Math.min(w * hopSize + windowSize, samples.length) }); inSpeech = false; } }
    }
  }
  if (inSpeech && regionCount >= minWindows) regions.push({ start: regionStart, end: samples.length });
  return regions;
}

// Calculate SNR
function calculateSNR(samples: Int16Array, sampleRate: number): number {
  if (samples.length === 0) return 0;
  const regions = detectSpeechRegions(samples, sampleRate);
  if (regions.length === 0) return 5.0;

  const speechSamples: number[] = [];
  for (const r of regions) for (let i = r.start; i < r.end; i++) speechSamples.push(samples[i] / 32768.0);
  if (speechSamples.length < sampleRate * 0.5) return 8.0;

  let sigSum = 0;
  for (const s of speechSamples) sigSum += s * s;
  const sigRMS = Math.sqrt(sigSum / speechSamples.length);
  if (sigRMS < 0.001) return 5.0;

  const silSamples: number[] = [];
  let lastEnd = 0;
  for (const r of regions) { for (let i = lastEnd; i < r.start; i++) silSamples.push(samples[i] / 32768.0); lastEnd = r.end; }
  for (let i = lastEnd; i < samples.length; i++) silSamples.push(samples[i] / 32768.0);

  let noiseRMS = 0.001;
  if (silSamples.length > sampleRate * 0.1) {
    let nSum = 0;
    for (const s of silSamples) nSum += s * s;
    noiseRMS = Math.sqrt(nSum / silSamples.length);
    if (noiseRMS < 0.0001) noiseRMS = 0.0001;
  }

  const snr = 20 * Math.log10(sigRMS / noiseRMS);
  return Math.round(Math.max(0, Math.min(60, snr)) * 10) / 10;
}

// Calculate RMS in dBFS
function calculateRMSLevel(samples: Int16Array): number {
  if (samples.length === 0) return -96.0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const n = samples[i] / 32768.0; sum += n * n; }
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return -96.0;
  return Math.round(Math.max(-96.0, Math.min(0, 20 * Math.log10(rms))) * 10) / 10;
}

// Mic bandwidth analysis
function analyzeMicBandwidth(samples: Int16Array, sampleRate: number): number {
  const fftSize = 2048;
  if (samples.length < fftSize) return sampleRate / 2;
  const floats = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) floats[i] = (samples[i] / 32768.0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));

  // Simple DFT magnitude for frequency bins
  const magnitudes = new Float64Array(fftSize / 2);
  for (let k = 0; k < fftSize / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < fftSize; n++) {
      const angle = -2 * Math.PI * k * n / fftSize;
      re += floats[n] * Math.cos(angle);
      im += floats[n] * Math.sin(angle);
    }
    magnitudes[k] = 20 * Math.log10(Math.sqrt(re * re + im * im) / fftSize + 1e-10);
  }

  // Find highest freq with energy above -80dB
  let maxFreq = 0;
  const binWidth = sampleRate / fftSize;
  for (let k = magnitudes.length - 1; k >= 0; k--) {
    if (magnitudes[k] > -80) { maxFreq = k * binWidth; break; }
  }
  return Math.round(maxFreq * 2); // Nyquist equivalent
}

function getMetricStatus(metric: string, value: number): 'good' | 'fair' | 'bad' {
  const t = THRESHOLDS[metric as keyof typeof THRESHOLDS];
  if (!t) return 'good';

  if (metric === 'rms') {
    const { min, max } = t as { min: number; max: number };
    if (value >= min && value <= max) return 'good';
    if (value >= min - 4 && value <= max + 4) return 'fair';
    return 'bad';
  }

  const { good, fair } = t as { good: number; fair: number };
  if (value >= good) return 'good';
  if (value >= fair) return 'fair';
  return 'bad';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const participantId = formData.get('participant_id') as string;
    const roomId = formData.get('room_id') as string;

    if (!audioFile || !participantId || !roomId) {
      return new Response(JSON.stringify({ error: 'Missing audio, participant_id, or room_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Audio test for participant ${participantId} in room ${roomId}, size: ${audioFile.size}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Update status to testing
    await supabase.from('room_participants').update({ audio_test_status: 'testing' }).eq('id', participantId);

    // Parse WAV
    const audioBytes = new Uint8Array(await audioFile.arrayBuffer());
    const header = parseWavHeader(audioBytes);
    if (!header) {
      throw new Error('Invalid WAV file');
    }

    // Downsample to 16kHz mono
    const samples = downsampleToMono16k(audioBytes, header);
    console.log(`Downsampled: ${samples.length} samples at 16kHz`);

    // Calculate local metrics
    const snr = calculateSNR(samples, 16000);
    const rms = calculateRMSLevel(samples);
    const micSr = analyzeMicBandwidth(samples, 16000);

    console.log(`Local metrics: SNR=${snr}, RMS=${rms}, MicSR=${micSr}`);

    // Call HuggingFace API for advanced metrics
    let advancedMetrics: Record<string, number | null> = {};
    const METRICS_API_URL = Deno.env.get('METRICS_API_URL');
    
    if (METRICS_API_URL) {
      try {
        const hfFormData = new FormData();
        hfFormData.append('file', new Blob([audioBytes], { type: 'audio/wav' }), 'test.wav');

        const headers: Record<string, string> = {};
        const METRICS_API_SECRET = Deno.env.get('METRICS_API_SECRET');
        if (METRICS_API_SECRET) headers['Authorization'] = `Bearer ${METRICS_API_SECRET}`;

        const apiResp = await fetch(`${METRICS_API_URL}/analyze`, {
          method: 'POST',
          headers,
          body: hfFormData,
        });

        if (apiResp.ok) {
          const m = await apiResp.json();
          advancedMetrics = {
            srmr: m.srmr ?? null,
            sigmos_disc: m.sigmos_disc ?? null,
            sigmos_ovrl: m.sigmos_ovrl ?? null,
            sigmos_reverb: m.sigmos_reverb ?? null,
            vqscore: m.vqscore ?? null,
            wvmos: m.wvmos ?? null,
            utmos: m.utmos ?? null,
          };
          console.log('Advanced metrics received:', JSON.stringify(advancedMetrics));
        } else {
          console.error('HF API error:', apiResp.status, await apiResp.text());
        }
      } catch (e) {
        console.error('HF API call failed:', e);
      }
    }

    // Build results
    const allMetrics: Record<string, { value: number | null; status: string; label: string }> = {
      snr: { value: snr, status: getMetricStatus('snr', snr), label: 'SNR (dB)' },
      rms: { value: rms, status: getMetricStatus('rms', rms), label: 'RMS (dBFS)' },
      device_sr: { value: header.sampleRate, status: 'good', label: 'Device SR (Hz)' },
      mic_sr: { value: micSr, status: getMetricStatus('mic_sr', micSr), label: 'Eff. BW (Hz)' },
    };

    // Add advanced metrics if available
    for (const [key, val] of Object.entries(advancedMetrics)) {
      if (val !== null && val !== undefined) {
        const labelMap: Record<string, string> = {
          srmr: 'SRMR', wvmos: 'WVMOS', utmos: 'UTMOS',
          sigmos_ovrl: 'SigMOS Ovrl', sigmos_disc: 'SigMOS Disc', sigmos_reverb: 'SigMOS Reverb',
          vqscore: 'VQScore',
        };
        allMetrics[key] = { value: val, status: getMetricStatus(key, val), label: labelMap[key] || key };
      }
    }

    // Generate guidance for failed/fair metrics
    const issues: { metric: string; label: string; status: string; guidance: string }[] = [];
    for (const [key, m] of Object.entries(allMetrics)) {
      if (m.status === 'bad' || m.status === 'fair') {
        const g = GUIDANCE[key];
        if (g) {
          let msg = g.low;
          if (key === 'rms' && m.value !== null && m.value > (THRESHOLDS.rms.max + 4)) {
            msg = g.high || g.low;
          }
          issues.push({ metric: key, label: m.label, status: m.status, guidance: msg });
        }
      }
    }

    // Determine overall pass/fail
    const hasBad = Object.values(allMetrics).some(m => m.status === 'bad');
    const overallStatus = hasBad ? 'failed' : 'passed';

    const results = {
      overall_status: overallStatus,
      metrics: allMetrics,
      issues,
      tested_at: new Date().toISOString(),
    };

    // Save results to participant
    await supabase.from('room_participants').update({
      audio_test_status: overallStatus,
      audio_test_results: results,
    }).eq('id', participantId);

    console.log(`Test result for ${participantId}: ${overallStatus} (${issues.length} issues)`);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Test error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Audio test failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
