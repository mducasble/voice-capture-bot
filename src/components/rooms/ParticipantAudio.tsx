import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

interface ParticipantAudioProps {
  participantId: string;
  participantName: string;
  stream: MediaStream | null;
  isRecording: boolean;
  sessionId: string;
  isMuted: boolean;
  campaignId?: string;
}

/**
 * Records each participant's individual audio using a clean pipeline
 * identical to the mixed recorder: source → gain(1.0) → AudioWorklet.
 * No audioProfile filters are applied — post-processing (Enhance) handles corrections.
 */
export const ParticipantAudio = ({
  participantId,
  participantName,
  stream,
  isRecording,
  sessionId,
  isMuted,
  campaignId,
}: ParticipantAudioProps) => {
  const [audioLevel, setAudioLevel] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const levelAudioContextRef = useRef<AudioContext | null>(null);
  const isRecordingRef = useRef(false);

  // Clean recording pipeline refs
  const recAudioContextRef = useRef<AudioContext | null>(null);
  const recWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const recSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recGainNodeRef = useRef<GainNode | null>(null);
  const recChunksRef = useRef<Float32Array[]>([]);

  // Audio level visualization — simple source → analyser, no filters
  useEffect(() => {
    if (!stream) return;

    const audioContext = new AudioContext();
    levelAudioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyserRef.current = analyser;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(Math.min(100, (average / 128) * 100));
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      audioContext.close();
    };
  }, [stream]);

  // Start/stop recording based on room state — clean pipeline identical to mixed
  useEffect(() => {
    if (!stream) return;

    const handleRecordingChange = async () => {
      if (isRecording && !isRecordingRef.current) {
        isRecordingRef.current = true;
        recChunksRef.current = [];

        const sampleRate = 48000;
        const audioContext = new AudioContext({ sampleRate });
        recAudioContextRef.current = audioContext;

        await audioContext.audioWorklet.addModule("/wav-processor.js");

        const source = audioContext.createMediaStreamSource(stream);
        recSourceNodeRef.current = source;

        // Clean pipeline: source → gain(1.0) → worklet (same as mixed)
        const gain = audioContext.createGain();
        gain.gain.value = 1.0;
        recGainNodeRef.current = gain;

        const workletNode = new AudioWorkletNode(audioContext, "wav-processor");
        recWorkletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event) => {
          if (event.data.type === "samples") {
            recChunksRef.current.push(event.data.samples);
          }
        };

        source.connect(gain);
        gain.connect(workletNode);

      } else if (!isRecording && isRecordingRef.current) {
        isRecordingRef.current = false;
        
        const workletNode = recWorkletNodeRef.current;
        const audioContext = recAudioContextRef.current;

        if (!audioContext || !workletNode) return;

        // Flush remaining samples
        await new Promise<void>((resolve) => {
          const handler = (event: MessageEvent) => {
            if (event.data.type === "samples") {
              recChunksRef.current.push(event.data.samples);
            }
            if (event.data.type === "done") {
              workletNode.port.removeEventListener("message", handler);
              resolve();
            }
          };
          workletNode.port.addEventListener("message", handler);
          workletNode.port.postMessage({ type: "stop" });
        });

        if (recChunksRef.current.length === 0) return;

        // Disconnect all nodes
        workletNode.disconnect();
        recGainNodeRef.current?.disconnect();
        try { recSourceNodeRef.current?.disconnect(); } catch { /* already disconnected */ }

        // Merge chunks
        const totalLength = recChunksRef.current.reduce((a, c) => a + c.length, 0);
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of recChunksRef.current) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        // Convert to 16-bit WAV (same logic as mixed)
        const actualSampleRate = audioContext.sampleRate;
        const pcm = float32ToInt16(merged);
        const wavBlob = createWavBlob(pcm, actualSampleRate, 1);

        await audioContext.close();
        recAudioContextRef.current = null;
        recWorkletNodeRef.current = null;
        recChunksRef.current = [];

        if (wavBlob && wavBlob.size > 0) {
          await uploadRecording(wavBlob);
        }
      }
    };

    handleRecordingChange();
  }, [isRecording, stream]);

  // Upload WAV recording to S3 via streaming proxy
  const uploadRecording = useCallback(async (wavBlob: Blob) => {
    if (!wavBlob || wavBlob.size === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const filename = `room_${sessionId}_${participantId}_${Date.now()}.wav`;
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      setUploadProgress(10);

      const streamUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-upload-to-s3?filename=${encodeURIComponent(filename)}&session_id=${encodeURIComponent(sessionId)}&content_type=${encodeURIComponent("audio/wav")}`;
      const streamRes = await fetch(streamUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "audio/wav",
        },
        body: wavBlob,
      });

      if (!streamRes.ok) {
        const errText = await streamRes.text();
        console.error("[ParticipantAudio] Stream proxy failed:", errText);
        throw new Error(`Stream upload failed: ${streamRes.status}`);
      }

      const { public_url: finalUrl } = await streamRes.json();

      setUploadProgress(70);

      const regRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-room-recording`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename,
            file_url: finalUrl,
            file_size_bytes: wavBlob.size,
            session_id: sessionId,
            participant_id: participantId,
            participant_name: participantName,
            recording_type: "individual",
            format: "wav",
            campaign_id: campaignId || null,
          }),
        }
      );

      if (!regRes.ok) throw new Error(`Registration failed: ${await regRes.text()}`);

      setUploadProgress(100);
      toast.success(`Áudio de ${participantName} enviado!`);
      
    } catch (error) {
      console.error("Upload error:", error);
      try {
        const fallbackFilename = `room_${sessionId}_${participantName}_${Date.now()}.wav`;
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fallbackFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.error(`Erro ao enviar áudio de ${participantName}. Arquivo salvo localmente!`);
      } catch (dlErr) {
        console.error("Local save also failed:", dlErr);
        toast.error(`Erro ao enviar áudio de ${participantName}`);
      }
    } finally {
      setIsUploading(false);
    }
  }, [sessionId, participantId, participantName, campaignId]);

  return (
    <div className="space-y-3">
      {/* Audio Level Meter */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Nível de Áudio</span>
          <span>{isMuted ? "Mudo" : `${Math.round(audioLevel)}%`}</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-75 ${
              isMuted 
                ? "bg-muted-foreground" 
                : audioLevel > 80 
                  ? "bg-red-500" 
                  : audioLevel > 50 
                    ? "bg-yellow-500" 
                    : "bg-green-500"
            }`}
            style={{ width: isMuted ? "0%" : `${audioLevel}%` }}
          />
        </div>
      </div>

      {/* Recording Status */}
      {isRecording && (
        <div className="flex items-center gap-2 text-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span className="text-red-500">Gravando...</span>
        </div>
      )}

      {/* Upload Progress */}
      {isUploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Enviando gravação...</span>
            <span>{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-1" />
        </div>
      )}
    </div>
  );
};

// --- WAV utilities (identical to useMixedRecorder) ---

function float32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

function createWavBlob(pcmData: Int16Array, sampleRate: number, numChannels: number): Blob {
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
