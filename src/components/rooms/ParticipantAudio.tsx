import { useEffect, useRef, useState, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useWavRecorder } from "@/hooks/useWavRecorder";

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
  
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const levelAudioContextRef = useRef<AudioContext | null>(null);
  const isRecordingRef = useRef(false);
  const pendingBlobRef = useRef<Blob | null>(null);

  const wavRecorder = useWavRecorder({ sampleRate: 48000, channels: 1 });

  // Audio level visualization (separate from recording) - with gain applied
  useEffect(() => {
    if (!stream) return;

    const audioContext = new AudioContext();
    levelAudioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyserRef.current = analyser;
    
    const source = audioContext.createMediaStreamSource(stream);
    
    // Apply same gain as recording for accurate level display
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 5.0; // Match recording gain
    
    source.connect(gainNode);
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
  }, [stream]);

  // Start/stop WAV recording based on room state
  useEffect(() => {
    if (!stream) return;

    const handleRecordingChange = async () => {
      if (isRecording && !isRecordingRef.current) {
        // Start recording
        isRecordingRef.current = true;
        await wavRecorder.startRecording(stream);
      } else if (!isRecording && isRecordingRef.current) {
        // Stop recording and get WAV blob
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

  // Upload WAV recording to S3 via pre-signed URL
  const uploadRecording = useCallback(async (wavBlob: Blob) => {
    if (!wavBlob || wavBlob.size === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const filename = `room_${sessionId}_${participantId}_${Date.now()}.wav`;

      // Step 1: Get pre-signed upload URL
      setUploadProgress(10);
      const urlResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-room-upload-url`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            filename,
            session_id: sessionId,
            content_type: "audio/wav",
          }),
        }
      );

      if (!urlResponse.ok) {
        const err = await urlResponse.text();
        throw new Error(`Failed to get upload URL: ${err}`);
      }

      const { upload_url, upload_headers, public_url } = await urlResponse.json();
      setUploadProgress(20);

      // Step 2: Upload directly to S3
      const s3Response = await fetch(upload_url, {
        method: "PUT",
        headers: upload_headers,
        body: wavBlob,
      });

      if (!s3Response.ok) {
        const errText = await s3Response.text();
        throw new Error(`S3 upload failed: ${s3Response.status} - ${errText}`);
      }

      setUploadProgress(70);

      // Step 3: Register recording metadata
      const registerResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-room-recording`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            filename,
            file_url: public_url,
            file_size_bytes: wavBlob.size,
            session_id: sessionId,
            participant_id: participantId,
            participant_name: participantName,
            recording_type: "individual",
            format: "wav",
          }),
        }
      );

      if (!registerResponse.ok) {
        throw new Error("Failed to register recording");
      }

      setUploadProgress(100);
      toast.success(`Áudio de ${participantName} enviado!`);
      
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(`Erro ao enviar áudio de ${participantName}`);
    } finally {
      setIsUploading(false);
      pendingBlobRef.current = null;
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
