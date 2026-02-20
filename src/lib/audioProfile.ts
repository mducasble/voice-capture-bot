/**
 * Adaptive Audio Profile Calculator
 * 
 * Computes optimal audio pipeline settings from test metrics.
 * Used to calibrate gain, filters, and noise reduction before recording.
 */

export interface AudioProfile {
  gain: number;           // 0.5 – 20.0
  highpassFreq: number;   // 40 – 150 Hz (0 = disabled)
  lowpassFreq: number;    // 8000 – 22000 Hz (0 = disabled)
  enableRnnoise: boolean;
  enableNoiseGate: boolean;
  enableEchoCancellation: boolean;
  enableNoiseSuppression: boolean;
  enableAutoGainControl: boolean;
}

export interface TestMetrics {
  snr?: number | null;
  rms?: number | null;
  srmr?: number | null;
  wvmos?: number | null;
  utmos?: number | null;
  sigmos_ovrl?: number | null;
  sigmos_disc?: number | null;
  sigmos_reverb?: number | null;
  vqscore?: number | null;
  mic_sr?: number | null;
}

const TARGET_RMS_DBFS = -23;
const MIN_GAIN = 0.5;
const MAX_GAIN = 20.0;

/**
 * Calculate optimal gain to reach target RMS level.
 * gain = 10^((targetRMS - measuredRMS) / 20)
 */
function calculateGain(rmsDbfs: number | null | undefined): number {
  if (rmsDbfs == null || rmsDbfs === 0) return 1.0;
  
  const diff = TARGET_RMS_DBFS - rmsDbfs;
  const gain = Math.pow(10, diff / 20);
  
  return Math.round(Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain)) * 100) / 100;
}

/**
 * Calculate highpass frequency based on SRMR (reverb indicator).
 * Lower SRMR = more reverb = higher cutoff to remove room rumble.
 */
function calculateHighpassFreq(srmr: number | null | undefined): number {
  if (srmr == null) return 80; // default
  
  if (srmr >= 10) return 40;    // clean room, minimal filtering
  if (srmr >= 6) return 80;     // moderate, standard cutoff
  if (srmr >= 3) return 120;    // reverberant, aggressive cutoff
  return 150;                    // very reverberant, max cutoff
}

/**
 * Calculate lowpass frequency based on effective mic sample rate.
 * No point keeping frequencies above what the mic actually captures.
 */
function calculateLowpassFreq(micSr: number | null | undefined): number {
  if (micSr == null) return 0; // disabled if unknown
  
  // Nyquist: useful freq = micSr / 2, but leave some headroom
  const nyquist = micSr / 2;
  
  if (nyquist >= 20000) return 0;     // full range mic, no filter needed
  if (nyquist >= 16000) return 18000;
  if (nyquist >= 8000) return 12000;
  return 6000;                         // low quality mic
}

/**
 * Compute the full adaptive audio profile from test results.
 */
export function computeAudioProfile(metrics: TestMetrics): AudioProfile {
  const snr = metrics.snr;
  const rms = metrics.rms;
  const srmr = metrics.srmr;
  const micSr = metrics.mic_sr;

  const gain = calculateGain(rms);
  const highpassFreq = calculateHighpassFreq(srmr);
  const lowpassFreq = calculateLowpassFreq(micSr);
  
  // Enable RNNoise if SNR is below threshold
  const enableRnnoise = snr != null && snr < 25;
  
  // Enable Noise Gate if SNR is very low
  const enableNoiseGate = snr != null && snr < 15;
  
  // Enable browser constraints individually if quality is below acceptable
  const needsConstraints = enableRnnoise || (srmr != null && srmr < 6);
  const enableEchoCancellation = needsConstraints;
  const enableNoiseSuppression = needsConstraints;
  const enableAutoGainControl = needsConstraints;

  return {
    gain,
    highpassFreq,
    lowpassFreq,
    enableRnnoise,
    enableNoiseGate,
    enableEchoCancellation,
    enableNoiseSuppression,
    enableAutoGainControl,
  };
}

/**
 * Default profile (no adjustments).
 */
export const DEFAULT_PROFILE: AudioProfile = {
  gain: 1.0,
  highpassFreq: 0,
  lowpassFreq: 0,
  enableRnnoise: false,
  enableNoiseGate: false,
  enableEchoCancellation: false,
  enableNoiseSuppression: false,
  enableAutoGainControl: false,
};

/**
 * Get human-readable descriptions for profile settings.
 */
export function getProfileDescriptions(profile: AudioProfile): { label: string; value: string; detail: string }[] {
  const items: { label: string; value: string; detail: string }[] = [];

  items.push({
    label: "Ganho",
    value: `${profile.gain.toFixed(2)}x`,
    detail: profile.gain === 1.0 ? "Sem amplificação" : 
            profile.gain > 1 ? `Amplifica ${((profile.gain - 1) * 100).toFixed(0)}% para atingir ~-23 dBFS` :
            `Reduz ${((1 - profile.gain) * 100).toFixed(0)}% para evitar distorção`,
  });

  items.push({
    label: "High-pass",
    value: profile.highpassFreq > 0 ? `${profile.highpassFreq} Hz` : "Desativado",
    detail: profile.highpassFreq > 0 
      ? `Remove frequências abaixo de ${profile.highpassFreq}Hz (rumble/reverb)` 
      : "Nenhum filtro de graves aplicado",
  });

  items.push({
    label: "Low-pass",
    value: profile.lowpassFreq > 0 ? `${(profile.lowpassFreq / 1000).toFixed(0)} kHz` : "Desativado",
    detail: profile.lowpassFreq > 0 
      ? `Corta acima de ${(profile.lowpassFreq / 1000).toFixed(0)}kHz (limite do microfone)` 
      : "Sem corte de altas frequências",
  });

  items.push({
    label: "RNNoise",
    value: profile.enableRnnoise ? "Ativado" : "Desativado",
    detail: profile.enableRnnoise 
      ? "Supressão de ruído de fundo via rede neural" 
      : "SNR suficiente, sem necessidade",
  });

  items.push({
    label: "Noise Gate",
    value: profile.enableNoiseGate ? "Ativado" : "Desativado",
    detail: profile.enableNoiseGate 
      ? "Silencia trechos sem fala para reduzir ruído residual" 
      : "SNR adequado, gate desnecessário",
  });

  items.push({
    label: "Echo Cancel.",
    value: profile.enableEchoCancellation ? "Ativado" : "Desativado",
    detail: profile.enableEchoCancellation 
      ? "Cancelamento de eco do navegador ativo" 
      : "Cancelamento de eco desativado",
  });

  items.push({
    label: "Noise Suppr.",
    value: profile.enableNoiseSuppression ? "Ativado" : "Desativado",
    detail: profile.enableNoiseSuppression 
      ? "Supressão de ruído nativa do navegador ativa" 
      : "Supressão de ruído nativa desativada",
  });

  items.push({
    label: "Auto Gain",
    value: profile.enableAutoGainControl ? "Ativado" : "Desativado",
    detail: profile.enableAutoGainControl 
      ? "Controle automático de ganho do navegador ativo" 
      : "Controle automático de ganho desativado",
  });

  return items;
}
