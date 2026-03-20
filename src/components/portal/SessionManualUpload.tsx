import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Loader2, CheckCircle, Users, Mic, AudioLines } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Participant {
  id: string;
  name: string;
  user_id: string | null;
  is_creator: boolean;
}

interface Props {
  sessionId: string;
  campaignId: string;
}

type TrackType = "mixed" | "host" | "participant";

export function SessionManualUpload({ sessionId, campaignId }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<TrackType | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploadedTracks, setUploadedTracks] = useState<Set<TrackType>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTrackType = useRef<TrackType | null>(null);

  // Fetch room participants for this session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Find the room by session_id
        const { data: room } = await supabase
          .from("rooms")
          .select("id")
          .eq("session_id", sessionId)
          .limit(1)
          .single();

        if (!room || cancelled) { setLoading(false); return; }

        const { data: parts } = await supabase
          .from("room_participants")
          .select("id, name, user_id, is_creator")
          .eq("room_id", room.id);

        if (!cancelled && parts) {
          setParticipants(parts as Participant[]);
        }
      } catch {
        // Session might not have a room record
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const host = participants.find(p => p.is_creator);
  const guest = participants.find(p => !p.is_creator);

  const handleUpload = useCallback((trackType: TrackType) => {
    pendingTrackType.current = trackType;
    fileInputRef.current?.click();
  }, []);

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const trackType = pendingTrackType.current;
    if (!file || !trackType) return;
    e.target.value = ""; // reset

    if (!file.name.toLowerCase().endsWith(".wav")) {
      toast.error("Apenas arquivos .WAV são aceitos");
      return;
    }

    setUploading(trackType);
    setProgress(0);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      // Determine who this recording belongs to
      let participantId = "manual";
      let participantName = "Manual Upload";
      let targetUserId: string | undefined;
      let recordingType = "individual";

      if (trackType === "mixed") {
        participantId = host?.id || "mixed";
        participantName = "Mixed";
        recordingType = "mixed";
      } else if (trackType === "host" && host) {
        participantId = host.id;
        participantName = host.name;
        targetUserId = host.user_id || undefined;
        recordingType = "individual";
      } else if (trackType === "participant" && guest) {
        participantId = guest.id;
        participantName = guest.name;
        targetUserId = guest.user_id || undefined;
        recordingType = "individual";
      }

      const filename = `room_${sessionId}_${trackType}_manual_${Date.now()}.wav`;

      setProgress(10);

      // Upload via streaming proxy
      const streamUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-upload-to-s3?filename=${encodeURIComponent(filename)}&session_id=${encodeURIComponent(sessionId)}&content_type=${encodeURIComponent("audio/wav")}`;

      const xhr = new XMLHttpRequest();
      const uploadPromise = new Promise<string>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) {
            setProgress(10 + Math.round((ev.loaded / ev.total) * 60));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const { public_url } = JSON.parse(xhr.responseText);
              resolve(public_url);
            } catch { reject(new Error("Invalid response")); }
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("POST", streamUrl);
        xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
        xhr.setRequestHeader("Content-Type", "audio/wav");
        xhr.send(file);
      });

      const finalUrl = await uploadPromise;
      setProgress(80);

      // Register in DB
      const regBody: Record<string, unknown> = {
        filename,
        file_url: finalUrl,
        file_size_bytes: file.size,
        session_id: sessionId,
        participant_id: participantId,
        participant_name: participantName,
        recording_type: recordingType,
        format: "wav",
        campaign_id: campaignId,
        sample_rate: 48000,
      };
      if (targetUserId) {
        regBody.target_user_id = targetUserId;
      }

      const regRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-room-recording`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(regBody),
        }
      );

      if (!regRes.ok) {
        throw new Error(`Registro falhou: ${await regRes.text()}`);
      }

      setProgress(100);
      setUploadedTracks(prev => new Set(prev).add(trackType));

      const label = trackType === "mixed" ? "Combinado" : trackType === "host" ? host?.name || "Host" : guest?.name || "Participante";
      toast.success(`Áudio de ${label} enviado com sucesso!`);
    } catch (err) {
      console.error("[ManualUpload] Error:", err);
      toast.error("Erro ao enviar: " + (err as Error).message);
    } finally {
      setUploading(null);
      setProgress(0);
    }
  }, [sessionId, campaignId, host, guest]);

  if (loading || participants.length < 2) return null;

  const buttons: { type: TrackType; label: string; icon: React.ReactNode; detail: string }[] = [
    {
      type: "mixed",
      label: "Combinado",
      icon: <AudioLines className="h-3.5 w-3.5" />,
      detail: "Áudio mixado da sessão",
    },
    {
      type: "host",
      label: host?.name || "Host",
      icon: <Mic className="h-3.5 w-3.5" />,
      detail: "Trilha individual do host",
    },
    {
      type: "participant",
      label: guest?.name || "Participante",
      icon: <Users className="h-3.5 w-3.5" />,
      detail: "Trilha individual do participante",
    },
  ];

  return (
    <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
      <span className="font-mono text-[11px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
        Enviar faltante:
      </span>
      {buttons.map(({ type, label, icon }) => {
        const isUploading = uploading === type;
        const isDone = uploadedTracks.has(type);

        return (
          <button
            key={type}
            onClick={(e) => { e.stopPropagation(); handleUpload(type); }}
            disabled={!!uploading || isDone}
            title={isDone ? "Já enviado" : `Enviar áudio: ${label}`}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest px-2.5 py-1 transition-all"
            style={{
              color: isDone ? "#22c55e" : isUploading ? "var(--portal-text-muted)" : "var(--portal-accent)",
              background: isDone ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${isDone ? "rgba(34,197,94,0.3)" : "var(--portal-border)"}`,
              cursor: uploading || isDone ? "default" : "pointer",
              opacity: uploading && !isUploading ? 0.4 : 1,
            }}
          >
            {isDone ? (
              <><CheckCircle className="h-3 w-3" /> {label}</>
            ) : isUploading ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> {progress}%</>
            ) : (
              <>{icon} {label}</>
            )}
          </button>
        );
      })}
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,audio/wav"
        className="hidden"
        onChange={onFileSelected}
      />
    </div>
  );
}
