import { useRef, useCallback, useState } from "react";

interface WavRecorderOptions {
  sampleRate?: number;
  channels?: number;
  gain?: number; // Amplification factor (1.0 = no change, 2.0 = double volume)
}

interface WavRecorderState {
  isRecording: boolean;
  duration: number;
}

export const useWavRecorder = (options: WavRecorderOptions = {}) => {
  const { sampleRate = 48000, channels = 1, gain = 15.0 } = options; // Default 15x gain
  
  const [state, setState] = useState<WavRecorderState>({
    isRecording: false,
    duration: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async (stream: MediaStream) => {
    chunksRef.current = [];
    
    // Create audio context with desired sample rate
    const audioContext = new AudioContext({ sampleRate });
    audioContextRef.current = audioContext;

    // Create source from stream
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;

    // Create gain node for amplification
    const gainNode = audioContext.createGain();
    gainNode.gain.value = gain;
    gainNodeRef.current = gainNode;

    // Create script processor (4096 buffer size for balance between latency and performance)
    const processorNode = audioContext.createScriptProcessor(4096, channels, channels);
    processorNodeRef.current = processorNode;

    // Capture audio data with soft clipping to prevent distortion
    processorNode.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      // Make a copy and apply soft clipping
      const processedData = new Float32Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        // Soft clipping using tanh to prevent harsh distortion
        processedData[i] = Math.tanh(inputData[i]);
      }
      chunksRef.current.push(processedData);
    };

    // Connect nodes: source -> gain -> processor -> destination
    sourceNode.connect(gainNode);
    gainNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    startTimeRef.current = Date.now();
    
    // Track duration
    durationIntervalRef.current = setInterval(() => {
      setState(prev => ({
        ...prev,
        duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));
    }, 1000);

    setState({ isRecording: true, duration: 0 });
  }, [sampleRate, channels, gain]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }

    if (!audioContextRef.current || chunksRef.current.length === 0) {
      setState({ isRecording: false, duration: 0 });
      return null;
    }

    // Disconnect nodes
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
    }

    // Merge all chunks into one buffer
    const totalLength = chunksRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
    const mergedBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      mergedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert Float32 to Int16 PCM
    const pcmData = float32ToInt16(mergedBuffer);

    // Create WAV file
    const wavBlob = createWavBlob(pcmData, sampleRate, channels);

    // Close audio context
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
    // Clamp value between -1 and 1
    const s = Math.max(-1, Math.min(1, buffer[i]));
    // Convert to 16-bit integer
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

// Create WAV blob from PCM data
function createWavBlob(pcmData: Int16Array, sampleRate: number, numChannels: number): Blob {
  const byteRate = sampleRate * numChannels * 2; // 16-bit = 2 bytes per sample
  const blockAlign = numChannels * 2;
  const dataSize = pcmData.length * 2;
  const bufferSize = 44 + dataSize; // 44 bytes for WAV header

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1 size (16 for PCM)
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // Bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
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
