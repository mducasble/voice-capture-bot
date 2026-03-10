import { useRef, useCallback, useState } from "react";

interface RemoteRecorderEntry {
  audioContext: AudioContext;
  workletNode: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  chunks: Float32Array[];
  participantName: string;
}

/**
 * Records each remote WebRTC stream individually on the creator's side
 * as a redundancy measure. If a remote participant disconnects before
 * uploading, the creator still has their audio captured.
 */
export const useRemoteRecorders = () => {
  const [isRecording, setIsRecording] = useState(false);
  const recordersRef = useRef<Map<string, RemoteRecorderEntry>>(new Map());
  const connectedIdsRef = useRef<Set<string>>(new Set());

  const startRecording = useCallback(
    async (
      remoteStreams: Map<string, MediaStream>,
      participants: { id: string; name: string }[]
    ) => {
      recordersRef.current.clear();
      connectedIdsRef.current.clear();

      const nameMap = new Map(participants.map((p) => [p.id, p.name]));

      for (const [peerId, stream] of remoteStreams) {
        try {
          await addStream(peerId, stream, nameMap.get(peerId) || peerId);
        } catch (e) {
          console.error(`[RemoteRecorders] Failed to start for ${peerId}:`, e);
        }
      }

      setIsRecording(true);
    },
    []
  );

  const addStream = async (
    peerId: string,
    stream: MediaStream,
    participantName: string
  ) => {
    if (connectedIdsRef.current.has(peerId)) return;
    connectedIdsRef.current.add(peerId);

    const sampleRate = 48000;
    const audioContext = new AudioContext({ sampleRate });
    await audioContext.audioWorklet.addModule("/wav-processor.js");

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "wav-processor");

    const entry: RemoteRecorderEntry = {
      audioContext,
      workletNode,
      source,
      chunks: [],
      participantName,
    };

    workletNode.port.onmessage = (event) => {
      if (event.data.type === "samples") {
        entry.chunks.push(event.data.samples);
      }
    };

    source.connect(workletNode);
    recordersRef.current.set(peerId, entry);
  };

  /** Add a late-joining remote stream mid-recording */
  const addRemoteStream = useCallback(
    async (
      peerId: string,
      stream: MediaStream,
      participantName: string
    ) => {
      if (!isRecording) return;
      try {
        await addStream(peerId, stream, participantName);
      } catch (e) {
        console.error(`[RemoteRecorders] Failed to add ${peerId}:`, e);
      }
    },
    [isRecording]
  );

  /** Stop all recorders and return Map<peerId, {blob, name}> */
  const stopRecording = useCallback(async (): Promise<
    Map<string, { blob: Blob; participantName: string }>
  > => {
    const results = new Map<
      string,
      { blob: Blob; participantName: string }
    >();

    for (const [peerId, entry] of recordersRef.current) {
      try {
        // Flush remaining samples
        await new Promise<void>((resolve) => {
          const handler = (event: MessageEvent) => {
            if (event.data.type === "samples") {
              entry.chunks.push(event.data.samples);
            }
            if (event.data.type === "done") {
              entry.workletNode.port.removeEventListener("message", handler);
              resolve();
            }
          };
          entry.workletNode.port.addEventListener("message", handler);
          entry.workletNode.port.postMessage({ type: "stop" });
        });

        if (entry.chunks.length > 0) {
          const totalLength = entry.chunks.reduce((a, c) => a + c.length, 0);
          const merged = new Float32Array(totalLength);
          let offset = 0;
          for (const chunk of entry.chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }

          const pcm = float32ToInt16(merged);
          const blob = createWavBlob(pcm, 48000, 1);
          results.set(peerId, {
            blob,
            participantName: entry.participantName,
          });
        }

        entry.workletNode.disconnect();
        entry.source.disconnect();
        await entry.audioContext.close();
      } catch (e) {
        console.error(`[RemoteRecorders] Error stopping ${peerId}:`, e);
      }
    }

    recordersRef.current.clear();
    connectedIdsRef.current.clear();
    setIsRecording(false);
    return results;
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    addRemoteStream,
  };
};

function float32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
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
