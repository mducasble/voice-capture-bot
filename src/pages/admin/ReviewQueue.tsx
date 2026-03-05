import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, FileAudio, Users, Play, Pause, ChevronDown, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useRef, useCallback, useMemo } from "react";

interface SessionRecording {
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
}

interface CampaignInfo {
  id: string;
  name: string;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min ${Math.round(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function TrackRow({ rec }: { rec: SessionRecording }) {
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
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50">
      {rec.file_url && (
        <button onClick={toggle} className="shrink-0 text-accent">
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      )}
      <span className="font-mono text-xs px-1.5 py-0.5 bg-secondary text-muted-foreground rounded-sm shrink-0">
        {rec.recording_type === "mixed" ? "MIX" : "IND"}
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-mono text-sm truncate block text-foreground">
          {rec.discord_username || rec.filename}
        </span>
      </div>
      {rec.duration_seconds != null && (
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {formatDuration(rec.duration_seconds)}
        </span>
      )}
      <span
        className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm shrink-0"
        style={{
          background: rec.status === "completed" ? "hsl(var(--accent) / 0.15)" : "hsl(var(--destructive) / 0.15)",
          color: rec.status === "completed" ? "hsl(var(--accent))" : "hsl(var(--destructive))",
        }}
      >
        {rec.status || "unknown"}
      </span>
    </div>
  );
}

interface SessionGroup {
  sessionId: string;
  recordings: SessionRecording[];
  mixed: SessionRecording | undefined;
  individuals: SessionRecording[];
  createdAt: string;
  campaignId: string | null;
}

function SessionCard({
  session,
  campaignName,
}: {
  session: SessionGroup;
  campaignName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = session.mixed?.duration_seconds
    || Math.max(...session.individuals.map(r => r.duration_seconds || 0), 0);

  return (
    <div className="border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 flex items-center gap-4 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-foreground">
              Sessão
            </span>
            <span className="font-mono text-xs px-1.5 py-0.5 bg-secondary text-muted-foreground">
              {session.sessionId.slice(0, 8)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              — {new Date(session.createdAt).toLocaleDateString("pt-BR")}{" "}
              {new Date(session.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <FileAudio className="h-3 w-3" />
              {session.recordings.length} {session.recordings.length === 1 ? "arquivo" : "arquivos"}
            </span>
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {session.individuals.length} {session.individuals.length === 1 ? "participante" : "participantes"}
            </span>
            {duration > 0 && (
              <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDuration(duration)}
              </span>
            )}
            <span className="font-mono text-[10px] px-2 py-0.5 bg-primary/10 text-primary">
              {campaignName}
            </span>
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="border-t border-border">
          {session.mixed && <TrackRow rec={session.mixed} />}
          {session.individuals.map(r => (
            <TrackRow key={r.id} rec={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewQueue() {
  // Fetch all recordings that have a session_id (portal sessions)
  const { data: recordings, isLoading } = useQuery({
    queryKey: ["admin_review_queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voice_recordings")
        .select("id, filename, duration_seconds, recording_type, session_id, created_at, discord_username, file_url, status, campaign_id")
        .not("session_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SessionRecording[];
    },
  });

  // Get unique campaign IDs and fetch names
  const campaignIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.campaign_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: campaigns } = useQuery({
    queryKey: ["admin_review_queue_campaigns", campaignIds],
    queryFn: async () => {
      if (!campaignIds.length) return [];
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name")
        .in("id", campaignIds);
      if (error) throw error;
      return (data || []) as CampaignInfo[];
    },
    enabled: campaignIds.length > 0,
  });

  const campaignMap = useMemo(() => {
    const m = new Map<string, string>();
    campaigns?.forEach(c => m.set(c.id, c.name));
    return m;
  }, [campaigns]);

  // Group recordings by session_id
  const sessions = useMemo(() => {
    if (!recordings) return [];
    const map = new Map<string, SessionRecording[]>();
    for (const r of recordings) {
      if (!r.session_id) continue;
      if (!map.has(r.session_id)) map.set(r.session_id, []);
      map.get(r.session_id)!.push(r);
    }
    const groups: SessionGroup[] = [];
    for (const [sessionId, recs] of map) {
      const mixed = recs.find(r => r.recording_type === "mixed");
      const individuals = recs.filter(r => r.recording_type === "individual");
      groups.push({
        sessionId,
        recordings: recs,
        mixed,
        individuals,
        createdAt: recs[0].created_at,
        campaignId: recs[0].campaign_id,
      });
    }
    // Sort by most recent first
    groups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return groups;
  }, [recordings]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/admin">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Fila de Revisão</h1>
            <p className="text-sm text-muted-foreground">
              {sessions.length} {sessions.length === 1 ? "sessão" : "sessões"} do portal
            </p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && sessions.length === 0 && (
          <div className="text-center py-16 border border-border bg-card">
            <FileAudio className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold text-foreground">Nenhuma sessão encontrada</h3>
            <p className="text-sm text-muted-foreground mt-1">
              As sessões enviadas pelo portal aparecerão aqui.
            </p>
          </div>
        )}

        {/* Session list */}
        <div className="space-y-3">
          {sessions.map(session => (
            <SessionCard
              key={session.sessionId}
              session={session}
              campaignName={campaignMap.get(session.campaignId || "") || "Sem campanha"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
