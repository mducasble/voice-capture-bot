import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useWavRecorder } from "@/hooks/useWavRecorder";
import type { AudioProfile } from "@/lib/audioProfile";


interface ParticipantAudioProps {
  participantId: string;
  participantName: string;
  stream: MediaStream | null;
  isRecording: boolean;
  sessionId: string;
  isMuted: boolean;
  noiseGateEnabled?: boolean;
  audioProfile?: AudioProfile | null;
  campaignId?: string;
}

export const ParticipantAudio = ({
  participantId,
  participantName,
  stream,
  isRecording,
  sessionId,
  isMuted,
  noiseGateEnabled = false,
  audioProfile = null,
  campaignId,
}: ParticipantAudioProps) => {
  const [audioLevel, setAudioLevel] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const levelAudioContextRef = useRef<AudioContext | null>(null);
  const isRecordingRef = useRef(false);
  const pendingBlobRef = useRef<Blob | null>(null);

  const wavRecorder = useWavRecorder({ sampleRate: 48000, channels: 1, profile: audioProfile });

  // Audio level visualization - mirrors the recording chain for accurate display
  useEffect(() => {
    if (!stream) return;

    const audioContext = new AudioContext();
    levelAudioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyserRef.current = analyser;
    
    const source = audioContext.createMediaStreamSource(stream);
    
    const gainNode = audioContext.createGain();
    gainNode.gain.value = audioProfile?.gain ?? 1.0;

    let lastNode: AudioNode = source;

    // Mirror filters from profile
    if (audioProfile && audioProfile.highpassFreq > 0) {
      const highpass = audioContext.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = audioProfile.highpassFreq;
      highpass.Q.value = 0.7;
      lastNode.connect(highpass);
      lastNode = highpass;
    }

    if (audioProfile && audioProfile.lowpassFreq > 0) {
      const lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = audioProfile.lowpassFreq;
      lowpass.Q.value = 0.7;
      lastNode.connect(lowpass);
      lastNode = lowpass;
    }

    lastNode.connect(gainNode);
    gainNode.connect(analyser);
    
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
  }, [stream, audioProfile]);

  // Start/stop WAV recording based on room state
  useEffect(() => {
    if (!stream) return;

    const handleRecordingChange = async () => {
      if (isRecording && !isRecordingRef.current) {
        isRecordingRef.current = true;
        await wavRecorder.startRecording(stream);
      } else if (!isRecording && isRecordingRef.current) {
        isRecordingRef.current = false;
        const wavBlob = await wavRecorder.stopRecording();
        if (wavBlob) {
          pendingBlobRef.current = wavBlob;
          await uploadRecording(wavBlob);
        }
      }
    };

    handleRecordingChange();
  }, [isRecording, stream, wavRecorder]);

  // Upload WAV recording to S3 via pre-signed URL (avoids memory limits)
  const uploadRecording = useCallback(async (wavBlob: Blob) => {
    if (!wavBlob || wavBlob.size === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const filename = `room_${sessionId}_${participantId}_${Date.now()}.wav`;
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      setUploadProgress(10);

      // 2. Upload via streaming proxy (avoids S3 CORS issues)
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

      // 3. Register in database
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
      // Fallback: download the individual audio so it's not lost
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
      pendingBlobRef.current = null;
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
