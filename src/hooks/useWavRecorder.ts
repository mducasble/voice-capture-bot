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

const RNNOISE_FRAME_SIZE = 480;

export const useWavRecorder = (options: WavRecorderOptions = {}) => {
  const { sampleRate = 48000, channels = 1, profile = null } = options;

  const [state, setState] = useState<WavRecorderState>({
    isRecording: false,
    duration: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const highpassRef = useRef<BiquadFilterNode | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  /**
   * Apply RNNoise to the full recording buffer (post-processing).
   * This avoids frame-boundary artifacts that occurred with real-time processing.
   */
  const applyRnnoise = useCallback(async (buffer: Float32Array): Promise<Float32Array> => {
    try {
      const { Rnnoise } = await import("@shiguredo/rnnoise-wasm");
      const rnnoise = await Rnnoise.load();
      const denoiseState = rnnoise.createDenoiseState();
      console.log("[AudioEnhancer] RNNoise loaded for post-processing");

      const result = new Float32Array(buffer.length);
      let offset = 0;

      // Process complete frames
      while (offset + RNNOISE_FRAME_SIZE <= buffer.length) {
        const frame = new Float32Array(RNNOISE_FRAME_SIZE);
        frame.set(buffer.subarray(offset, offset + RNNOISE_FRAME_SIZE));
        denoiseState.processFrame(frame);
        result.set(frame, offset);
        offset += RNNOISE_FRAME_SIZE;
      }

      // Handle remaining samples (zero-pad last frame)
      if (offset < buffer.length) {
        const remaining = buffer.length - offset;
        const frame = new Float32Array(RNNOISE_FRAME_SIZE);
        frame.set(buffer.subarray(offset, offset + remaining));
        denoiseState.processFrame(frame);
        result.set(frame.subarray(0, remaining), offset);
      }

      denoiseState.destroy();
      console.log("[AudioEnhancer] RNNoise post-processing complete");
      return result;
    } catch (err) {
      console.error("[AudioEnhancer] Failed to apply RNNoise:", err);
      return buffer;
    }
  }, []);

  const startRecording = useCallback(async (stream: MediaStream) => {
    chunksRef.current = [];

    const p = profileRef.current;
    const gainValue = p?.gain ?? 1.0;
    const hpFreq = p?.highpassFreq ?? 0;
    const lpFreq = p?.lowpassFreq ?? 0;

    const audioContext = new AudioContext({ sampleRate });
    audioContextRef.current = audioContext;

    // Register the AudioWorklet processor
    await audioContext.audioWorklet.addModule('/wav-processor.js');

    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = gainValue;
    gainNodeRef.current = gainNode;

    // Build audio chain: source → [highpass] → [lowpass] → gain → worklet
    let lastNode: AudioNode = sourceNode;

    if (hpFreq > 0) {
      const highpass = audioContext.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = hpFreq;
      highpass.Q.value = 0.7;
      highpassRef.current = highpass;
      lastNode.connect(highpass);
      lastNode = highpass;
    }

    if (lpFreq > 0) {
      const lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = lpFreq;
      lowpass.Q.value = 0.7;
      lowpassRef.current = lowpass;
      lastNode.connect(lowpass);
      lastNode = lowpass;
    }

    lastNode.connect(gainNode);

    // Create AudioWorkletNode (runs in dedicated audio thread)
    const workletNode = new AudioWorkletNode(audioContext, 'wav-processor');
    workletNodeRef.current = workletNode;

    workletNode.port.onmessage = (event) => {
      if (event.data.type === 'samples') {
        chunksRef.current.push(event.data.samples);
      }
    };

    gainNode.connect(workletNode);

    startTimeRef.current = Date.now();

    durationIntervalRef.current = setInterval(() => {
      setState(prev => ({
        ...prev,
        duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));
    }, 1000);

    setState({ isRecording: true, duration: 0 });
  }, [sampleRate, channels]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }

    const workletNode = workletNodeRef.current;
    const audioContext = audioContextRef.current;

    if (!audioContext || !workletNode) {
      setState({ isRecording: false, duration: 0 });
      return null;
    }

    // Signal the worklet to flush remaining samples and stop
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === 'samples') {
          chunksRef.current.push(event.data.samples);
        }
        if (event.data.type === 'done') {
          workletNode.port.removeEventListener('message', handler);
          resolve();
        }
      };
      workletNode.port.addEventListener('message', handler);
      workletNode.port.postMessage({ type: 'stop' });
    });

    if (chunksRef.current.length === 0) {
      setState({ isRecording: false, duration: 0 });
      return null;
    }

    // Disconnect nodes
    workletNode.disconnect();
    gainNodeRef.current?.disconnect();
    highpassRef.current?.disconnect();
    lowpassRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();

    // Merge all chunks
    const totalLength = chunksRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
    const rawBuffer = new ArrayBuffer(totalLength * 4);
    let mergedBuffer = new Float32Array(rawBuffer);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      mergedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Apply RNNoise as post-processing if enabled
    const p = profileRef.current;
    if (p?.enableRnnoise) {
      const denoised = await applyRnnoise(mergedBuffer);
      mergedBuffer = new Float32Array(new ArrayBuffer(denoised.length * 4));
      mergedBuffer.set(denoised);
    }

    const pcmData = float32ToInt16(mergedBuffer);
    const wavBlob = createWavBlob(pcmData, sampleRate, channels);

    await audioContext.close();
    audioContextRef.current = null;
    workletNodeRef.current = null;
    chunksRef.current = [];

    setState({ isRecording: false, duration: 0 });

    return wavBlob;
  }, [sampleRate, channels, applyRnnoise]);

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
