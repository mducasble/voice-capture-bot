import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Loader2, CheckCircle, Play, Pause, Mic, Users, AudioLines, Signal, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Participant {
  id: string;
  name: string;
  user_id: string | null;
  is_creator: boolean;
}

interface SubmissionRow {
  id: string;
  filename: string;
  duration_seconds: number | null;
  recording_type: string | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  file_url: string | null;
  status: string | null;
  quality_status: string | null;
  validation_status: string | null;
  snr_db: number | null;
  quality_rejection_reason: string | null;
  validation_rejection_reason: string | null;
  campaign_id: string;
  submission_type: string;
}

type TrackType = "mixed" | "host" | "participant";

function getUnifiedStatus(rec: SubmissionRow): { label: string; color: string; bg: string; icon: React.ReactNode; reason?: string | null } {
  const qa = rec.quality_status;
  const val = rec.validation_status;
  if (qa === "rejected" || val === "rejected") {
    const reason = rec.quality_rejection_reason || rec.validation_rejection_reason;
    return { label: reason ? `Reprovado: ${reason}` : "Reprovado", color: "#ef4444", bg: "rgba(239,68,68,0.15)", icon: <XCircle className="h-3.5 w-3.5" />, reason };
  }
  if ((qa === "approved" || qa === "validated") && (val === "approved" || val === "validated")) {
    return { label: "Aprovado", color: "#22c55e", bg: "rgba(34,197,94,0.15)", icon: <CheckCircle className="h-3.5 w-3.5" /> };
  }
  return { label: "Em análise", color: "var(--portal-text-muted)", bg: "rgba(255,255,255,0.05)", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> };
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function TrackRow({ rec, label, icon }: { rec: SubmissionRow; label: string; icon: React.ReactNode }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    if (!rec.file_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(rec.file_url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  }, [playing, rec.file_url]);

  const s = getUnifiedStatus(rec);

  return (
    <div className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: "1px solid var(--portal-border)" }}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {rec.file_url && (
          <button onClick={toggle} className="shrink-0" style={{ color: "var(--portal-accent)" }}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}
        <span className="shrink-0" style={{ color: "var(--portal-text-muted)" }}>{icon}</span>
        <span className="font-mono text-sm truncate" style={{ color: "var(--portal-text)" }}>{label}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {rec.snr_db != null && (
          <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5" style={{
            color: rec.snr_db >= 25 ? "#22c55e" : rec.snr_db >= 15 ? "#eab308" : "#ef4444",
            background: rec.snr_db >= 25 ? "rgba(34,197,94,0.15)" : rec.snr_db >= 15 ? "rgba(234,179,8,0.15)" : "rgba(239,68,68,0.15)",
          }}>
            <Signal className="h-3 w-3" /> {rec.snr_db.toFixed(1)}dB
          </span>
        )}
        <span className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest px-2 py-0.5" style={{ color: s.color, background: s.bg }} title={s.reason || undefined}>
          {s.icon} {s.label}
        </span>
        {rec.duration_seconds != null && (
          <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            <Clock className="h-3 w-3 inline mr-0.5" />{formatDuration(rec.duration_seconds)}
          </span>
        )}
      </div>
    </div>
  );
}

function MissingTrackRow({ label, icon, trackType, onUpload, uploading, progress }: {
  label: string;
  icon: React.ReactNode;
  trackType: TrackType;
  onUpload: (type: TrackType) => void;
  uploading: TrackType | null;
  progress: number;
}) {
  const isUploading = uploading === trackType;
  const isDisabled = !!uploading;

  return (
    <div className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: "1px solid var(--portal-border)", opacity: isDisabled && !isUploading ? 0.5 : 1 }}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="shrink-0" style={{ color: "var(--portal-text-muted)" }}>{icon}</span>
        <span className="font-mono text-sm truncate" style={{ color: "var(--portal-text-muted)" }}>{label}</span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onUpload(trackType); }}
        disabled={isDisabled}
        className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest px-3 py-1.5 transition-all"
        style={{
          color: isUploading ? "var(--portal-text-muted)" : "var(--portal-accent)",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid var(--portal-border)",
          cursor: isDisabled ? "default" : "pointer",
        }}
      >
        {isUploading ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> {progress}%</>
        ) : (
          <><Upload className="h-3 w-3" /> Enviar áudio</>
        )}
      </button>
    </div>
  );
}

interface SessionBlockProps {
  sessionId: string;
  campaignId: string;
  recordings: SubmissionRow[];
}

export function SessionBlock({ sessionId, campaignId, recordings }: SessionBlockProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loadingParts, setLoadingParts] = useState(true);
  const [uploading, setUploading] = useState<TrackType | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploadedTracks, setUploadedTracks] = useState<Set<TrackType>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTrackType = useRef<TrackType | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: room } = await supabase
          .from("rooms")
          .select("id")
          .eq("session_id", sessionId)
          .limit(1)
          .single();
        if (!room || cancelled) { setLoadingParts(false); return; }
        const { data: parts } = await supabase
          .from("room_participants")
          .select("id, name, user_id, is_creator")
          .eq("room_id", room.id);
        if (!cancelled && parts) setParticipants(parts as Participant[]);
      } catch { /* no room record */ }
      finally { if (!cancelled) setLoadingParts(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const host = participants.find(p => p.is_creator);
  const guest = participants.find(p => !p.is_creator);

  // Match recordings to track types
  const mixedRec = recordings.find(r => r.recording_type === "mixed");
  // For individual tracks, match by discord_username (participant name) or discord_user_id
  const hostRec = recordings.find(r =>
    r.recording_type === "individual" && host && (
      r.discord_username === host.name || r.discord_username === host.id
    )
  );
  const guestRec = recordings.find(r =>
    r.recording_type === "individual" && guest && (
      r.discord_username === guest.name || r.discord_username === guest.id
    )
  );

  // Fallback: if we have exactly 2 individual tracks (or 1), just assign by order
  const individualRecs = recordings.filter(r => r.recording_type === "individual");
  const effectiveHostRec = hostRec || (individualRecs.length >= 1 && host ? individualRecs.find(r => {
    // Try matching by user context - first individual is likely host
    if (guestRec && r.id === guestRec.id) return false;
    return true;
  }) : undefined);
  const effectiveGuestRec = guestRec || (individualRecs.length >= 2 && guest ? individualRecs.find(r => {
    if (effectiveHostRec && r.id === effectiveHostRec.id) return false;
    return true;
  }) : undefined);

  const handleUpload = useCallback((trackType: TrackType) => {
    pendingTrackType.current = trackType;
    fileInputRef.current?.click();
  }, []);

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const trackType = pendingTrackType.current;
    if (!file || !trackType) return;
    e.target.value = "";

    if (!file.name.toLowerCase().endsWith(".wav")) {
      toast.error("Apenas arquivos .WAV são aceitos");
      return;
    }

    setUploading(trackType);
    setProgress(0);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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
      } else if (trackType === "participant" && guest) {
        participantId = guest.id;
        participantName = guest.name;
        targetUserId = guest.user_id || undefined;
      }

      const filename = `room_${sessionId}_${trackType}_manual_${Date.now()}.wav`;
      setProgress(10);

      const streamUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-upload-to-s3?filename=${encodeURIComponent(filename)}&session_id=${encodeURIComponent(sessionId)}&content_type=${encodeURIComponent("audio/wav")}`;

      const xhr = new XMLHttpRequest();
      const uploadPromise = new Promise<string>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) setProgress(10 + Math.round((ev.loaded / ev.total) * 60));
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText).public_url); }
            catch { reject(new Error("Invalid response")); }
          } else { reject(new Error(`Upload failed: ${xhr.status}`)); }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("POST", streamUrl);
        xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
        xhr.setRequestHeader("Content-Type", "audio/wav");
        xhr.send(file);
      });

      const finalUrl = await uploadPromise;
      setProgress(80);

      const regBody: Record<string, unknown> = {
        filename, file_url: finalUrl, file_size_bytes: file.size,
        session_id: sessionId, participant_id: participantId,
        participant_name: participantName, recording_type: recordingType,
        format: "wav", campaign_id: campaignId, sample_rate: 48000,
      };
      if (targetUserId) regBody.target_user_id = targetUserId;

      const regRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-room-recording`,
        { method: "POST", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify(regBody) }
      );

      if (!regRes.ok) throw new Error(`Registro falhou: ${await regRes.text()}`);

      setProgress(100);
      setUploadedTracks(prev => new Set(prev).add(trackType));
      const label = trackType === "mixed" ? "Combinado" : trackType === "host" ? host?.name || "Host" : guest?.name || "Participante";
      toast.success(`Áudio de ${label} enviado com sucesso!`);
    } catch (err) {
      console.error("[SessionBlock] Upload error:", err);
      toast.error("Erro ao enviar: " + (err as Error).message);
    } finally {
      setUploading(null);
      setProgress(0);
    }
  }, [sessionId, campaignId, host, guest]);

  // While loading participants, show what we have
  const sessionDuration = mixedRec?.duration_seconds ?? individualRecs.reduce((s, r) => Math.max(s, r.duration_seconds || 0), 0);

  // Track definitions
  const hostLabel = host?.name || "Host";
  const guestLabel = guest?.name || "Participante";

  const hasParts = !loadingParts && participants.length >= 2;

  return (
    <div>
      {/* Session header */}
      <div className="px-4 py-2 flex items-center gap-2 flex-wrap" style={{ background: "rgba(0,0,0,0.15)" }}>
        <span className="font-mono text-sm uppercase tracking-widest font-bold" style={{ color: "var(--portal-accent)" }}>
          Sessão{" "}
          <span className="px-1.5 py-0.5" style={{ background: "var(--portal-border)", color: "var(--portal-text)" }}>
            {sessionId.slice(0, 8)}
          </span>
          {" "}— {new Date(recordings[0]?.created_at || Date.now()).toLocaleDateString("pt-BR")}
        </span>
        {sessionDuration > 0 && (
          <span className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>{formatDuration(sessionDuration)}</span>
        )}
      </div>

      {/* Mixed track */}
      {mixedRec && !uploadedTracks.has("mixed") ? (
        <TrackRow rec={mixedRec} label="🎧 Áudio Combinado" icon={<AudioLines className="h-3.5 w-3.5" />} />
      ) : uploadedTracks.has("mixed") ? (
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <AudioLines className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
          <span className="font-mono text-sm" style={{ color: "var(--portal-text)" }}>🎧 Áudio Combinado</span>
          <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 ml-auto" style={{ color: "#22c55e", background: "rgba(34,197,94,0.15)" }}>
            <CheckCircle className="h-3 w-3" /> Enviado
          </span>
        </div>
      ) : hasParts ? (
        <MissingTrackRow label="🎧 Áudio Combinado" icon={<AudioLines className="h-3.5 w-3.5" />} trackType="mixed" onUpload={handleUpload} uploading={uploading} progress={progress} />
      ) : null}

      {/* Host track */}
      {hasParts && (
        effectiveHostRec && !uploadedTracks.has("host") ? (
          <TrackRow rec={effectiveHostRec} label={`🎙️ ${hostLabel}`} icon={<Mic className="h-3.5 w-3.5" />} />
        ) : uploadedTracks.has("host") ? (
          <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
            <Mic className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
            <span className="font-mono text-sm" style={{ color: "var(--portal-text)" }}>🎙️ {hostLabel}</span>
            <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 ml-auto" style={{ color: "#22c55e", background: "rgba(34,197,94,0.15)" }}>
              <CheckCircle className="h-3 w-3" /> Enviado
            </span>
          </div>
        ) : (
          <MissingTrackRow label={`🎙️ ${hostLabel}`} icon={<Mic className="h-3.5 w-3.5" />} trackType="host" onUpload={handleUpload} uploading={uploading} progress={progress} />
        )
      )}

      {/* Guest track */}
      {hasParts && (
        effectiveGuestRec && !uploadedTracks.has("participant") ? (
          <TrackRow rec={effectiveGuestRec} label={`👤 ${guestLabel}`} icon={<Users className="h-3.5 w-3.5" />} />
        ) : uploadedTracks.has("participant") ? (
          <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
            <Users className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
            <span className="font-mono text-sm" style={{ color: "var(--portal-text)" }}>👤 {guestLabel}</span>
            <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 ml-auto" style={{ color: "#22c55e", background: "rgba(34,197,94,0.15)" }}>
              <CheckCircle className="h-3 w-3" /> Enviado
            </span>
          </div>
        ) : (
          <MissingTrackRow label={`👤 ${guestLabel}`} icon={<Users className="h-3.5 w-3.5" />} trackType="participant" onUpload={handleUpload} uploading={uploading} progress={progress} />
        )
      )}

      {/* Fallback: if no room_participants found, show raw recordings */}
      {!hasParts && !loadingParts && recordings.filter(r => r.recording_type !== "mixed").map(r => (
        <TrackRow key={r.id} rec={r} label={r.discord_username || r.filename} icon={<Mic className="h-3.5 w-3.5" />} />
      ))}

      <input ref={fileInputRef} type="file" accept=".wav,audio/wav" className="hidden" onChange={onFileSelected} />
    </div>
  );
}
