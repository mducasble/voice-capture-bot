import { useRef, useCallback, useState } from "react";

interface MixedRecorderState {
  isRecording: boolean;
}

/**
 * Records a mixed-down WAV (48kHz/16-bit/mono) from the local stream
 * combined with all remote WebRTC streams.
 *
 * The mixing uses Web Audio API's ChannelMergerNode/destination approach:
 * each input stream is connected to a shared AudioContext and routed through
 * a GainNode (for equal weighting) into an AudioWorkletNode that captures PCM.
 */
export const useMixedRecorder = () => {
  const [state, setState] = useState<MixedRecorderState>({ isRecording: false });

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const gainNodeRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const connectedPeerIdsRef = useRef<Set<string>>(new Set());
  const connectedStreamIdsRef = useRef<Set<string>>(new Set());

  const startRecording = useCallback(
    async (
      localStream: MediaStream,
      remoteStreams: Map<string, MediaStream>
    ) => {
      chunksRef.current = [];
      connectedPeerIdsRef.current = new Set();
      connectedStreamIdsRef.current = new Set();
      const sampleRate = 48000;
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/wav-processor.js");

      // Master gain – keeps overall level consistent
      const masterGain = audioContext.createGain();
      const streamCount = 1 + remoteStreams.size;
      // Slightly reduce per-stream to avoid clipping when many participants
      masterGain.gain.value = Math.min(1, 1.5 / Math.sqrt(streamCount));
      gainNodeRef.current = masterGain;

      // Connect local stream
      const localSource = audioContext.createMediaStreamSource(localStream);
      localSource.connect(masterGain);
      sourceNodesRef.current.push(localSource);
      connectedStreamIdsRef.current.add(localStream.id);

      // Connect each remote stream
      remoteStreams.forEach((stream) => {
        const src = audioContext.createMediaStreamSource(stream);
        src.connect(masterGain);
        sourceNodesRef.current.push(src);
        connectedStreamIdsRef.current.add(stream.id);
      });

      // AudioWorklet captures the mixed PCM
      const workletNode = new AudioWorkletNode(audioContext, "wav-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        if (event.data.type === "samples") {
          chunksRef.current.push(event.data.samples);
        }
      };

      masterGain.connect(workletNode);

      setState({ isRecording: true });
    },
    []
  );

  /**
   * Dynamically add a new remote stream that joined mid-recording.
   */
  const addRemoteStream = useCallback((stream: MediaStream, peerId?: string) => {
    const ctx = audioContextRef.current;
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    // Deduplicate by peerId first (handles Daily.co stream renegotiation),
    // fall back to stream.id for backward compatibility
    const dedupeKey = peerId || stream.id;
    if (connectedPeerIdsRef.current.has(dedupeKey)) return;
    if (connectedStreamIdsRef.current.has(stream.id)) return;
    connectedPeerIdsRef.current.add(dedupeKey);
    connectedStreamIdsRef.current.add(stream.id);

    const src = ctx.createMediaStreamSource(stream);
    src.connect(gain);
    sourceNodesRef.current.push(src);

    // Rebalance gain
    const count = sourceNodesRef.current.length;
    gain.gain.value = Math.min(1, 1.5 / Math.sqrt(count));
  }, []);

  const stopRecording = useCallback(async (): Promise<{ blob: Blob; sampleRate: number } | null> => {
    const workletNode = workletNodeRef.current;
    const audioContext = audioContextRef.current;

    if (!audioContext || !workletNode) {
      setState({ isRecording: false });
      return null;
    }

    // Flush remaining samples
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "samples") {
          chunksRef.current.push(event.data.samples);
        }
        if (event.data.type === "done") {
          workletNode.port.removeEventListener("message", handler);
          resolve();
        }
      };
      workletNode.port.addEventListener("message", handler);
      workletNode.port.postMessage({ type: "stop" });
    });

    if (chunksRef.current.length === 0) {
      setState({ isRecording: false });
      return null;
    }

    // Disconnect all nodes
    workletNode.disconnect();
    gainNodeRef.current?.disconnect();
    sourceNodesRef.current.forEach((s) => {
      try { s.disconnect(); } catch { /* already disconnected */ }
    });
    sourceNodesRef.current = [];

    // Merge chunks
    const totalLength = chunksRef.current.reduce((a, c) => a + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to 16-bit WAV using the ACTUAL sample rate from the context
    const actualSampleRate = audioContext.sampleRate;
    console.log(`[MixedRecorder] Context sampleRate: ${actualSampleRate}, total samples: ${totalLength}`);
    const pcm = float32ToInt16(merged);
    const wavBlob = createWavBlob(pcm, actualSampleRate, 1);

    await audioContext.close();
    audioContextRef.current = null;
    workletNodeRef.current = null;
    chunksRef.current = [];

    setState({ isRecording: false });
    return { blob: wavBlob, sampleRate: actualSampleRate };
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
    addRemoteStream,
  };
};

function float32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

function createWavBlob(
  pcmData: Int16Array,
  sampleRate: number,
  numChannels: number
): Blob {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmData.length * 2;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const pcmOffset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(pcmOffset + i * 2, pcmData[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
