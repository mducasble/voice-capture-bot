import { useRef, useCallback, useState } from "react";
import type { AudioProfile } from "@/lib/audioProfile";

interface WavRecorderOptions {
  sampleRate?: number;
  channels?: number;
  profile?: AudioProfile | null;
}

interface WavRecorderState {
  isRecording: boolean;
  duration: number;
}

const RNNOISE_FRAME_SIZE = 480; // RNNoise expects 480 samples at 48kHz (10ms)

export const useWavRecorder = (options: WavRecorderOptions = {}) => {
  const { sampleRate = 48000, channels = 1, profile = null } = options;
  
  const [state, setState] = useState<WavRecorderState>({
    isRecording: false,
    duration: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const highpassRef = useRef<BiquadFilterNode | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const rnnoiseStateRef = useRef<any>(null);
  const rnnoiseLeftoverRef = useRef<Float32Array>(new Float32Array(0));
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const loadRnnoise = useCallback(async () => {
    try {
      const { Rnnoise } = await import("@shiguredo/rnnoise-wasm");
      const rnnoise = await Rnnoise.load();
      const denoiseState = rnnoise.createDenoiseState();
      rnnoiseStateRef.current = denoiseState;
      console.log("[AudioEnhancer] RNNoise loaded successfully");
    } catch (err) {
      console.error("[AudioEnhancer] Failed to load RNNoise:", err);
    }
  }, []);

  const processWithRnnoise = useCallback((inputData: Float32Array): Float32Array => {
    const denoiseState = rnnoiseStateRef.current;
    if (!denoiseState) return inputData;

    const leftover = rnnoiseLeftoverRef.current;
    const combined = new Float32Array(leftover.length + inputData.length);
    combined.set(leftover);
    combined.set(inputData, leftover.length);

    const processedChunks: Float32Array[] = [];
    let offset = 0;

    while (offset + RNNOISE_FRAME_SIZE <= combined.length) {
      const frame = new Float32Array(RNNOISE_FRAME_SIZE);
      frame.set(combined.subarray(offset, offset + RNNOISE_FRAME_SIZE));
      denoiseState.processFrame(frame);
      processedChunks.push(frame);
      offset += RNNOISE_FRAME_SIZE;
    }

    rnnoiseLeftoverRef.current = combined.slice(offset);

    const totalLength = processedChunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Float32Array(totalLength);
    let resultOffset = 0;
    for (const chunk of processedChunks) {
      result.set(chunk, resultOffset);
      resultOffset += chunk.length;
    }

    return result;
  }, []);

  const startRecording = useCallback(async (stream: MediaStream) => {
    chunksRef.current = [];
    rnnoiseLeftoverRef.current = new Float32Array(0);
    
    const p = profileRef.current;
    const gainValue = p?.gain ?? 1.0;
    const useRnnoise = p?.enableRnnoise ?? false;
    const hpFreq = p?.highpassFreq ?? 0;
    const lpFreq = p?.lowpassFreq ?? 0;
    
    const audioContext = new AudioContext({ sampleRate });
    audioContextRef.current = audioContext;

    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;

    // Create gain node
    const gainNode = audioContext.createGain();
    gainNode.gain.value = gainValue;
    gainNodeRef.current = gainNode;

    // Build audio chain
    let lastNode: AudioNode = sourceNode;

    // Add highpass filter if configured
    if (hpFreq > 0) {
      const highpass = audioContext.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = hpFreq;
      highpass.Q.value = 0.7;
      highpassRef.current = highpass;
      lastNode.connect(highpass);
      lastNode = highpass;
    }

    // Add lowpass filter if configured
    if (lpFreq > 0) {
      const lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = lpFreq;
      lowpass.Q.value = 0.7;
      lowpassRef.current = lowpass;
      lastNode.connect(lowpass);
      lastNode = lowpass;
    }

    // Load RNNoise if needed
    if (useRnnoise) {
      await loadRnnoise();
    }

    // Connect gain
    lastNode.connect(gainNode);

    // Create script processor
    const processorNode = audioContext.createScriptProcessor(4096, channels, channels);
    processorNodeRef.current = processorNode;

    processorNode.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      if (useRnnoise && rnnoiseStateRef.current) {
        const denoised = processWithRnnoise(inputData);
        const processed = new Float32Array(denoised.length);
        for (let i = 0; i < denoised.length; i++) {
          processed[i] = Math.max(-1, Math.min(1, denoised[i]));
        }
        if (processed.length > 0) {
          chunksRef.current.push(processed);
        }
      } else {
        const processedData = new Float32Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          processedData[i] = Math.max(-1, Math.min(1, inputData[i]));
        }
        chunksRef.current.push(processedData);
      }
    };

    gainNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    startTimeRef.current = Date.now();
    
    durationIntervalRef.current = setInterval(() => {
      setState(prev => ({
        ...prev,
        duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));
    }, 1000);

    setState({ isRecording: true, duration: 0 });
  }, [sampleRate, channels, loadRnnoise, processWithRnnoise]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }

    if (!audioContextRef.current || chunksRef.current.length === 0) {
      setState({ isRecording: false, duration: 0 });
      return null;
    }

    // Process any remaining RNNoise leftover
    if (rnnoiseStateRef.current && rnnoiseLeftoverRef.current.length > 0) {
      const remaining = rnnoiseLeftoverRef.current;
      if (remaining.length > 0) {
        const frame = new Float32Array(RNNOISE_FRAME_SIZE);
        frame.set(remaining);
        rnnoiseStateRef.current.processFrame(frame);
        const clipped = new Float32Array(remaining.length);
        for (let i = 0; i < remaining.length; i++) {
          clipped[i] = Math.max(-1, Math.min(1, frame[i]));
        }
        chunksRef.current.push(clipped);
      }
    }

    // Disconnect nodes
    processorNodeRef.current?.disconnect();
    gainNodeRef.current?.disconnect();
    highpassRef.current?.disconnect();
    lowpassRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();

    // Clean up RNNoise
    if (rnnoiseStateRef.current) {
      try { rnnoiseStateRef.current.destroy(); } catch {}
      rnnoiseStateRef.current = null;
    }
    rnnoiseLeftoverRef.current = new Float32Array(0);

    // Merge all chunks
    const totalLength = chunksRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
    const mergedBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      mergedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    const pcmData = float32ToInt16(mergedBuffer);
    const wavBlob = createWavBlob(pcmData, sampleRate, channels);

    await audioContextRef.current.close();
    audioContextRef.current = null;
    chunksRef.current = [];

    setState({ isRecording: false, duration: 0 });
    
    return wavBlob;
  }, [sampleRate, channels]);

  return {
    ...state,
    startRecording,
    stopRecording,
  };
};

// Convert Float32Array (-1 to 1) to Int16Array (-32768 to 32767)
function float32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

// Create WAV blob from PCM data
function createWavBlob(pcmData: Int16Array, sampleRate: number, numChannels: number): Blob {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmData.length * 2;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const pcmOffset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(pcmOffset + i * 2, pcmData[i], true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
