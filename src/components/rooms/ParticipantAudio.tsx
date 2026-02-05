import { useEffect, useRef, useState, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

interface ParticipantAudioProps {
  participantId: string;
  participantName: string;
  stream: MediaStream | null;
  isRecording: boolean;
  sessionId: string;
  isMuted: boolean;
}

export const ParticipantAudio = ({
  participantId,
  participantName,
  stream,
  isRecording,
  sessionId,
  isMuted,
}: ParticipantAudioProps) => {
  const [audioLevel, setAudioLevel] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Audio level visualization
  useEffect(() => {
    if (!stream) return;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
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

  // Start/stop recording based on room state
  useEffect(() => {
    if (!stream) return;

    if (isRecording && !mediaRecorderRef.current) {
      // Start recording
      recordedChunksRef.current = [];
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (recordedChunksRef.current.length > 0) {
          await uploadRecording();
        }
      };

      mediaRecorder.start(1000); // Collect data every second
      mediaRecorderRef.current = mediaRecorder;
      
    } else if (!isRecording && mediaRecorderRef.current) {
      // Stop recording
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }

    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [isRecording, stream]);

  // Upload recording to S3
  const uploadRecording = useCallback(async () => {
    if (recordedChunksRef.current.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
      const filename = `room_${sessionId}_${participantId}_${Date.now()}.webm`;

      // Convert to base64 for upload
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(blob);
      const base64Data = await base64Promise;

      setUploadProgress(30);

      // Upload via edge function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-room-recording`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            filename,
            audio_base64: base64Data,
            session_id: sessionId,
            participant_id: participantId,
            participant_name: participantName,
            recording_type: "individual",
          }),
        }
      );

      setUploadProgress(80);

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      setUploadProgress(100);
      toast.success(`Áudio de ${participantName} enviado!`);
      
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(`Erro ao enviar áudio de ${participantName}`);
    } finally {
      setIsUploading(false);
      recordedChunksRef.current = [];
    }
  }, [sessionId, participantId, participantName]);

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
