import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, Mic, FileAudio, AlertTriangle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Participant {
  id: string;
  name: string;
  is_creator: boolean;
  is_connected: boolean;
  joined_at: string;
  left_at: string | null;
  audio_test_status: string;
}

interface Recording {
  id: string;
  filename: string;
  recording_type: string;
  duration_seconds: number | null;
  snr_db: number | null;
  quality_status: string | null;
  validation_status: string | null;
  sample_rate: number | null;
  channels: number | null;
  file_size_bytes: number | null;
  metadata: any;
  created_at: string;
  discord_username: string | null;
}

interface RoomSummary {
  id: string;
  room_name: string | null;
  creator_name: string;
  status: string;
  is_recording: boolean;
  created_at: string;
  recording_started_at: string | null;
  session_id: string | null;
  topic: string | null;
  duration_minutes: number | null;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  waiting: { label: "Aguardando", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  active: { label: "Aberta", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  live: { label: "Ao Vivo", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  completed: { label: "Finalizada", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  lost: { label: "Perdida", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  expired: { label: "Expirada", color: "bg-muted text-muted-foreground border-border" },
};

const qualityColor = (status: string | null) => {
  if (status === "approved") return "text-emerald-400";
  if (status === "rejected") return "text-red-400";
  return "text-muted-foreground";
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  room: RoomSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RoomDetailDialog({ room, open, onOpenChange }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!room || !open) return;
    setLoading(true);

    const fetchData = async () => {
      const [partRes, recRes] = await Promise.all([
        supabase
          .from("room_participants")
          .select("id, name, is_creator, is_connected, joined_at, left_at, audio_test_status")
          .eq("room_id", room.id),
        room.session_id
          ? supabase
              .from("voice_recordings")
              .select("id, filename, recording_type, duration_seconds, snr_db, quality_status, validation_status, sample_rate, channels, file_size_bytes, metadata, created_at, discord_username")
              .eq("session_id", room.session_id)
              .order("recording_type", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      setParticipants((partRes.data as Participant[]) || []);
      setRecordings((recRes.data as Recording[]) || []);
      setLoading(false);
    };

    fetchData();
  }, [room, open]);

  if (!room) return null;

  const cfg = statusConfig[room.status] || statusConfig.waiting;
  const totalDuration = recordings
    .filter((r) => r.recording_type === "individual")
    .reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
  const mixedRec = recordings.find((r) => r.recording_type === "mixed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="truncate">{room.room_name || `Sala de ${room.creator_name}`}</span>
            <Badge variant="outline" className={`text-[10px] uppercase tracking-wider border ${cfg.color} shrink-0`}>
              {cfg.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Room info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoRow label="Criada" value={format(new Date(room.created_at), "dd/MM HH:mm", { locale: ptBR })} />
          <InfoRow
            label="Tempo"
            value={formatDistanceToNow(new Date(room.created_at), { locale: ptBR })}
          />
          {room.topic && <InfoRow label="Tema" value={room.topic} />}
          {room.recording_started_at && (
            <InfoRow
              label="Gravação iniciada"
              value={format(new Date(room.recording_started_at), "HH:mm:ss", { locale: ptBR })}
            />
          )}
        </div>

        {/* Participants */}
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Participantes ({participants.length})
          </h3>
          {loading ? (
            <p className="text-xs text-muted-foreground">Carregando...</p>
          ) : (
            <div className="space-y-1.5">
              {participants.map((p) => {
                const isOnline = p.is_connected && !p.left_at;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/30 border border-border/30 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
                      <span className="font-medium text-foreground">{p.name}</span>
                      {p.is_creator && (
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">host</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{format(new Date(p.joined_at), "HH:mm")}</span>
                      {p.left_at && (
                        <span>saiu {format(new Date(p.left_at), "HH:mm")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recordings */}
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileAudio className="h-3.5 w-3.5" />
            Gravações ({recordings.length})
            {totalDuration > 0 && (
              <span className="text-muted-foreground font-normal ml-1">
                · {formatDuration(totalDuration)} total individual
              </span>
            )}
          </h3>
          {loading ? (
            <p className="text-xs text-muted-foreground">Carregando...</p>
          ) : recordings.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nenhuma gravação encontrada</p>
          ) : (
            <div className="space-y-2">
              {recordings.map((rec) => (
                <RecordingRow key={rec.id} rec={rec} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-secondary/20 border border-border/20">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function RecordingRow({ rec }: { rec: Recording }) {
  const meta = rec.metadata || {};
  const sigmos = meta.sigmos_ovrl != null ? Number(meta.sigmos_ovrl).toFixed(2) : null;
  const srmr = meta.srmr != null ? Number(meta.srmr).toFixed(2) : null;
  const vqscore = meta.vqscore != null ? Number(meta.vqscore).toFixed(2) : null;
  const snr = rec.snr_db != null ? Number(rec.snr_db).toFixed(1) : null;
  const rms = meta.rms_dbfs != null ? Number(meta.rms_dbfs).toFixed(1) : null;

  const isIndividual = rec.recording_type === "individual";
  const isMixed = rec.recording_type === "mixed";
  const speakerName = rec.discord_username || rec.filename.replace(/\.wav$/i, "").split("_").pop();

  return (
    <div className="px-3 py-2.5 rounded-lg bg-secondary/30 border border-border/30">
      {/* Row 1: name + type + duration */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Mic className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
            {speakerName}
          </span>
          <Badge
            variant="outline"
            className={`text-[9px] uppercase tracking-wider border ${
              isMixed
                ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                : "bg-blue-500/20 text-blue-400 border-blue-500/30"
            }`}
          >
            {isMixed ? "mixed" : "individual"}
          </Badge>
          {/* Quality + Validation badges */}
          {rec.quality_status && rec.quality_status !== "pending" && (
            <Badge
              variant="outline"
              className={`text-[9px] uppercase border ${
                rec.quality_status === "approved"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}
            >
              Q: {rec.quality_status === "approved" ? "✓" : "✗"}
            </Badge>
          )}
          {rec.validation_status && rec.validation_status !== "pending" && (
            <Badge
              variant="outline"
              className={`text-[9px] uppercase border ${
                rec.validation_status === "approved"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}
            >
              V: {rec.validation_status === "approved" ? "✓" : "✗"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatDuration(rec.duration_seconds)}</span>
          <span>{formatBytes(rec.file_size_bytes)}</span>
        </div>
      </div>

      {/* Row 2: Metrics */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {snr && <Metric label="SNR" value={`${snr} dB`} good={Number(snr) >= 25} />}
        {sigmos && <Metric label="SigMOS" value={sigmos} good={Number(sigmos) >= 3.5} />}
        {srmr && <Metric label="SRMR" value={srmr} good={Number(srmr) >= 6} />}
        {vqscore && <Metric label="VQScore" value={vqscore} good={Number(vqscore) >= 0.65} />}
        {rms && <Metric label="RMS" value={`${rms} dBFS`} />}
        {rec.sample_rate && <Metric label="SR" value={`${rec.sample_rate / 1000}kHz`} />}
      </div>
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <span className="text-muted-foreground">
      {label}{" "}
      <span className={good === true ? "text-emerald-400 font-medium" : good === false ? "text-amber-400 font-medium" : "text-foreground font-medium"}>
        {value}
      </span>
    </span>
  );
}
