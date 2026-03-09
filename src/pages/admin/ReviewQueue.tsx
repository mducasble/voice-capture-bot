import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock, FileAudio, Users, Play, Pause, ChevronDown, ArrowLeft,
  CheckCircle2, XCircle, AlertCircle, Volume2, Loader2,
} from "lucide-react";
import { useState, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";

// ---- types ----

interface Recording {
  id: string;
  filename: string;
  duration_seconds: number | null;
  recording_type: string | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  file_url: string | null;
  status: string | null;
  campaign_id: string | null;
  user_id: string | null;
  quality_status: string | null;
  validation_status: string | null;
  quality_rejection_reason: string | null;
  validation_rejection_reason: string | null;
  snr_db: number | null;
  sample_rate: number | null;
  transcription_status: string | null;
}

interface CampaignInfo {
  id: string;
  name: string;
  description: string | null;
  campaign_type: string | null;
}

interface ProfileInfo {
  id: string;
  full_name: string | null;
  email_contact: string | null;
}

interface RoomInfo {
  id: string;
  session_id: string | null;
  topic: string | null;
  creator_name: string;
}

// ---- helpers ----

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min ${Math.round(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function snrColor(snr: number | null) {
  if (snr == null) return "hsl(0 0% 50%)";
  if (snr >= 25) return "hsl(120 60% 45%)";
  if (snr >= 15) return "hsl(40 80% 50%)";
  return "hsl(0 70% 50%)";
}

type ReviewField = "quality_status" | "validation_status";

function StatusPill({ status }: { status: string | null }) {
  const s = status || "pending";
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: "hsl(40 80% 50% / 0.15)", fg: "hsl(40 80% 50%)", label: "Pendente" },
    approved: { bg: "hsl(120 60% 45% / 0.15)", fg: "hsl(120 60% 45%)", label: "Aprovado" },
    rejected: { bg: "hsl(0 70% 50% / 0.15)", fg: "hsl(0 70% 50%)", label: "Rejeitado" },
  };
  const style = map[s] || map.pending;
  return (
    <span
      className="font-mono text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold"
      style={{ background: style.bg, color: style.fg }}
    >
      {style.label}
    </span>
  );
}

// ---- Track Row with approval ----

function TrackRow({
  rec,
  onApprove,
  isPending,
}: {
  rec: Recording;
  onApprove: (id: string, field: ReviewField, status: "approved" | "rejected") => void;
  isPending: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    if (!rec.file_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(rec.file_url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }, [playing, rec.file_url]);

  return (
    <div className="px-4 py-3 border-b border-border/30 space-y-2">
      {/* Main row */}
      <div className="flex items-center gap-3">
        {rec.file_url && (
          <button onClick={toggle} className="shrink-0 text-accent hover:text-accent/80 transition-colors">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        )}
        <span className="font-mono text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground rounded-sm shrink-0">
          {rec.recording_type === "mixed" ? "MIX" : "IND"}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-mono text-sm truncate block text-foreground">
            {rec.discord_username || rec.filename}
          </span>
        </div>
        {rec.snr_db != null && (
          <span className="font-mono text-[10px] font-bold shrink-0" style={{ color: snrColor(rec.snr_db) }}>
            SNR {rec.snr_db.toFixed(1)}dB
          </span>
        )}
        {rec.duration_seconds != null && (
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {formatDuration(rec.duration_seconds)}
          </span>
        )}
      </div>

      {/* Approval controls */}
      <div className="flex items-center gap-4 pl-7 flex-wrap">
        {/* Quality */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">QA</span>
          <StatusPill status={rec.quality_status} />
          {rec.quality_status !== "approved" && (
            <button
              onClick={() => onApprove(rec.id, "quality_status", "approved")}
              disabled={isPending}
              className="p-1 rounded hover:bg-accent/10 transition-colors"
              title="Aprovar QA"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            </button>
          )}
          {rec.quality_status !== "rejected" && (
            <button
              onClick={() => onApprove(rec.id, "quality_status", "rejected")}
              disabled={isPending}
              className="p-1 rounded hover:bg-destructive/10 transition-colors"
              title="Rejeitar QA"
            >
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            </button>
          )}
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Validation */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">VAL</span>
          <StatusPill status={rec.validation_status} />
          {rec.validation_status !== "approved" && (
            <button
              onClick={() => onApprove(rec.id, "validation_status", "approved")}
              disabled={isPending}
              className="p-1 rounded hover:bg-accent/10 transition-colors"
              title="Aprovar VAL"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            </button>
          )}
          {rec.validation_status !== "rejected" && (
            <button
              onClick={() => onApprove(rec.id, "validation_status", "rejected")}
              disabled={isPending}
              className="p-1 rounded hover:bg-destructive/10 transition-colors"
              title="Rejeitar VAL"
            >
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            </button>
          )}
        </div>

        {rec.transcription_status && (
          <>
            <div className="w-px h-4 bg-border" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Transcrição: {rec.transcription_status}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Session group within a campaign ----

interface SessionGroup {
  sessionId: string;
  recordings: Recording[];
  mixed: Recording | undefined;
  individuals: Recording[];
  createdAt: string;
  topic: string | null;
  creatorName: string | null;
}

function SessionCard({
  session,
  profileMap,
  onApprove,
  isPending,
}: {
  session: SessionGroup;
  profileMap: Map<string, string>;
  onApprove: (id: string, field: ReviewField, status: "approved" | "rejected") => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = session.mixed?.duration_seconds
    || Math.max(...session.individuals.map(r => r.duration_seconds || 0), 0);

  const pendingCount = session.recordings.filter(
    r => r.quality_status === "pending" || r.validation_status === "pending"
  ).length;

  return (
    <div className="border border-border/50 bg-card/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs px-1.5 py-0.5 bg-secondary text-muted-foreground">
              {session.sessionId.slice(0, 8)}
            </span>
            {session.topic && (
              <span className="text-xs text-muted-foreground">· {session.topic}</span>
            )}
            {session.creatorName && (
              <span className="text-xs text-muted-foreground">· {session.creatorName}</span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {new Date(session.createdAt).toLocaleDateString("pt-BR")}{" "}
              {new Date(session.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <FileAudio className="h-3 w-3" /> {session.recordings.length}
            </span>
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <Users className="h-3 w-3" /> {session.individuals.length}
            </span>
            {duration > 0 && (
              <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> {formatDuration(duration)}
              </span>
            )}
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-amber-500">
                <AlertCircle className="h-3 w-3" /> {pendingCount} pendente(s)
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="border-t border-border/30">
          {session.mixed && (
            <div>
              <div className="px-4 py-1 bg-accent/5">
                <span className="font-mono text-[9px] uppercase tracking-widest text-accent">🎧 Áudio Combinado</span>
              </div>
              <TrackRow rec={session.mixed} onApprove={onApprove} isPending={isPending} />
            </div>
          )}
          {session.individuals.map(r => {
            const userName = r.user_id ? (profileMap.get(r.user_id) || r.discord_username || "Participante") : (r.discord_username || "Participante");
            return (
              <div key={r.id}>
                <div className="px-4 py-1 bg-secondary/30">
                  <span className="font-mono text-[10px] text-muted-foreground">👤 {userName}</span>
                </div>
                <TrackRow rec={r} onApprove={onApprove} isPending={isPending} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Campaign group ----

function CampaignGroup({
  campaign,
  sessions,
  roomMap,
  profileMap,
  onApprove,
  isPending,
}: {
  campaign: CampaignInfo;
  sessions: SessionGroup[];
  roomMap: Map<string, RoomInfo>;
  profileMap: Map<string, string>;
  onApprove: (id: string, field: ReviewField, status: "approved" | "rejected") => void;
  isPending: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const totalPending = sessions.reduce(
    (acc, s) => acc + s.recordings.filter(r => r.quality_status === "pending" || r.validation_status === "pending").length,
    0
  );

  return (
    <div className="border border-border bg-card">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full text-left p-4 flex items-center gap-4 hover:bg-secondary/20 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-base font-bold text-foreground">{campaign.name}</h2>
            {totalPending > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
                {totalPending} pendente(s)
              </Badge>
            )}
          </div>
          {campaign.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{campaign.description}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            {sessions.length} {sessions.length === 1 ? "sessão" : "sessões"} · {sessions.reduce((a, s) => a + s.recordings.length, 0)} arquivos
          </p>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
          style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
        />
      </button>
      {!collapsed && (
        <div className="border-t border-border p-3 space-y-2">
          {sessions.map(session => (
            <SessionCard
              key={session.sessionId}
              session={session}
              profileMap={profileMap}
              onApprove={onApprove}
              isPending={isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main page ----

export default function ReviewQueue() {
  const queryClient = useQueryClient();

  // Fetch recordings with review fields
  const { data: recordings, isLoading } = useQuery({
    queryKey: ["admin_review_queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voice_recordings")
        .select("id, filename, duration_seconds, recording_type, session_id, created_at, discord_username, file_url, status, campaign_id, user_id, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, snr_db, sample_rate, transcription_status")
        .not("session_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Recording[];
    },
  });

  // Campaign info
  const campaignIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.campaign_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: campaigns } = useQuery({
    queryKey: ["admin_review_campaigns", campaignIds],
    queryFn: async () => {
      if (!campaignIds.length) return [];
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, description, campaign_type")
        .in("id", campaignIds);
      if (error) throw error;
      return (data || []) as CampaignInfo[];
    },
    enabled: campaignIds.length > 0,
  });

  // Profiles for user names
  const userIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.user_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: profiles } = useQuery({
    queryKey: ["admin_review_profiles", userIds],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email_contact")
        .in("id", userIds);
      if (error) throw error;
      return (data || []) as ProfileInfo[];
    },
    enabled: userIds.length > 0,
  });

  // Rooms for topic/creator
  const sessionIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.session_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: rooms } = useQuery({
    queryKey: ["admin_review_rooms", sessionIds],
    queryFn: async () => {
      if (!sessionIds.length) return [];
      const { data, error } = await supabase
        .from("rooms")
        .select("id, session_id, topic, creator_name")
        .in("session_id", sessionIds);
      if (error) throw error;
      return (data || []) as RoomInfo[];
    },
    enabled: sessionIds.length > 0,
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    profiles?.forEach(p => m.set(p.id, p.full_name || p.email_contact || p.id.slice(0, 8)));
    return m;
  }, [profiles]);

  const campaignMap = useMemo(() => {
    const m = new Map<string, CampaignInfo>();
    campaigns?.forEach(c => m.set(c.id, c));
    return m;
  }, [campaigns]);

  const roomMap = useMemo(() => {
    const m = new Map<string, RoomInfo>();
    rooms?.forEach(r => { if (r.session_id) m.set(r.session_id, r); });
    return m;
  }, [rooms]);

  // Group: campaign → sessions → recordings
  const campaignGroups = useMemo(() => {
    if (!recordings) return [];
    const byCampaign = new Map<string, Map<string, Recording[]>>();

    for (const r of recordings) {
      const cid = r.campaign_id || "__none__";
      const sid = r.session_id || r.id;
      if (!byCampaign.has(cid)) byCampaign.set(cid, new Map());
      const sessionMap = byCampaign.get(cid)!;
      if (!sessionMap.has(sid)) sessionMap.set(sid, []);
      sessionMap.get(sid)!.push(r);
    }

    const result: { campaign: CampaignInfo; sessions: SessionGroup[] }[] = [];

    for (const [cid, sessionMap] of byCampaign) {
      const campaign = campaignMap.get(cid) || { id: cid, name: "Sem campanha", description: null, campaign_type: null };
      const sessions: SessionGroup[] = [];

      for (const [sid, recs] of sessionMap) {
        const mixed = recs.find(r => r.recording_type === "mixed");
        const individuals = recs.filter(r => r.recording_type !== "mixed");
        const room = roomMap.get(sid);
        sessions.push({
          sessionId: sid,
          recordings: recs,
          mixed,
          individuals,
          createdAt: recs[0].created_at,
          topic: room?.topic || null,
          creatorName: room?.creator_name || null,
        });
      }

      sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      result.push({ campaign, sessions });
    }

    // Sort campaigns: most pending first
    result.sort((a, b) => {
      const pendingA = a.sessions.reduce((acc, s) => acc + s.recordings.filter(r => r.quality_status === "pending" || r.validation_status === "pending").length, 0);
      const pendingB = b.sessions.reduce((acc, s) => acc + s.recordings.filter(r => r.quality_status === "pending" || r.validation_status === "pending").length, 0);
      return pendingB - pendingA;
    });

    return result;
  }, [recordings, campaignMap, roomMap]);

  // Approve/reject mutation
  const approveMutation = useMutation({
    mutationFn: async ({ id, field, status }: { id: string; field: ReviewField; status: string }) => {
      const reviewedField = field === "quality_status" ? "quality_reviewed_at" : "validation_reviewed_at";
      const reviewerField = field === "quality_status" ? "quality_reviewed_by" : "validation_reviewed_by";
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("voice_recordings")
        .update({
          [field]: status,
          [reviewedField]: new Date().toISOString(),
          [reviewerField]: user?.id || null,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_review_queue"] });
      toast.success("Status atualizado");
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao atualizar");
    },
  });

  const handleApprove = (id: string, field: ReviewField, status: "approved" | "rejected") => {
    approveMutation.mutate({ id, field, status });
  };

  const totalSessions = campaignGroups.reduce((a, g) => a + g.sessions.length, 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Fila de Aprovação</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {campaignGroups.length} {campaignGroups.length === 1 ? "campanha" : "campanhas"} · {totalSessions} {totalSessions === 1 ? "sessão" : "sessões"}
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {/* Empty */}
      {!isLoading && campaignGroups.length === 0 && (
        <div className="text-center py-16 border border-border bg-card">
          <FileAudio className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Nenhuma sessão encontrada</h3>
          <p className="text-sm text-muted-foreground mt-1">As sessões enviadas pelo portal aparecerão aqui.</p>
        </div>
      )}

      {/* Campaign groups */}
      <div className="space-y-4">
        {campaignGroups.map(({ campaign, sessions }) => (
          <CampaignGroup
            key={campaign.id}
            campaign={campaign}
            sessions={sessions}
            roomMap={roomMap}
            profileMap={profileMap}
            onApprove={handleApprove}
            isPending={approveMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}
