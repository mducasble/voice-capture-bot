import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen, FileAudio, Clock, ChevronDown, Play, Pause, ArrowRight } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";
import { useState, useRef, useCallback } from "react";

interface RecordingRow {
  id: string;
  filename: string;
  duration_seconds: number | null;
  recording_type: string | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  file_url: string | null;
  status: string | null;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function SessionRow({ rec }: { rec: RecordingRow }) {
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
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{ borderBottom: "1px solid var(--portal-border)" }}
    >
      {rec.file_url && (
        <button onClick={toggle} className="shrink-0" style={{ color: "var(--portal-accent)" }}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      )}
      <div className="flex-1 min-w-0">
        <span className="font-mono text-sm truncate block" style={{ color: "var(--portal-text)" }}>
          {rec.discord_username || rec.filename}
        </span>
      </div>
      {rec.duration_seconds != null && (
        <span className="font-mono text-xs shrink-0" style={{ color: "var(--portal-text-muted)" }}>
          {formatDuration(rec.duration_seconds)}
        </span>
      )}
      <span className="font-mono text-xs shrink-0" style={{ color: "var(--portal-text-muted)" }}>
        {new Date(rec.created_at).toLocaleDateString("pt-BR")}
      </span>
    </div>
  );
}

function CampaignCard({ participation, recordings }: { participation: any; recordings: RecordingRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const campaign = participation.campaigns;
  if (!campaign) return null;

  const sessions = recordings.filter(r => r.recording_type === "mixed");
  const individuals = recordings.filter(r => r.recording_type === "individual");
  const totalDuration = recordings.reduce((s, r) => s + (r.duration_seconds || 0), 0);

  // Group individuals by session_id
  const sessionGroups = new Map<string, RecordingRow[]>();
  for (const r of individuals) {
    const key = r.session_id || r.id;
    if (!sessionGroups.has(key)) sessionGroups.set(key, []);
    sessionGroups.get(key)!.push(r);
  }

  return (
    <div style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-5 flex items-center justify-between gap-4 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-base font-bold uppercase tracking-tight truncate" style={{ color: "var(--portal-text)" }}>
            {campaign.name}
          </h2>
          {campaign.description && (
            <p className="font-mono text-sm mt-1 truncate" style={{ color: "var(--portal-text-muted)" }}>
              {campaign.description}
            </p>
          )}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Desde {new Date(participation.joined_at).toLocaleDateString("pt-BR")}
            </span>
            {sessions.length > 0 && (
              <span className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                <FileAudio className="h-3.5 w-3.5" />
                {sessions.length} {sessions.length === 1 ? "sessão" : "sessões"}
              </span>
            )}
            {totalDuration > 0 && (
              <span className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                <Clock className="h-3.5 w-3.5" />
                {formatDuration(totalDuration)}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{
            color: "var(--portal-text-muted)",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--portal-border)" }}>
          {recordings.length === 0 ? (
            <div className="p-6 text-center">
              <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
                Nenhum material enviado ainda.
              </p>
            </div>
          ) : (
            <div>
              {/* Group by session */}
              {Array.from(sessionGroups.entries()).map(([sessionId, recs]) => {
                const mixed = sessions.find(s => s.session_id === sessionId);
                return (
                  <div key={sessionId}>
                    <div className="px-4 py-2 flex items-center gap-2" style={{ background: "rgba(0,0,0,0.15)" }}>
                      <span className="font-mono text-xs uppercase tracking-widest font-bold" style={{ color: "var(--portal-accent)" }}>
                        Sessão {sessionId.slice(0, 8)} — {new Date(recs[0].created_at).toLocaleDateString("pt-BR")}
                      </span>
                      {mixed?.duration_seconds != null && (
                        <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                          {formatDuration(mixed.duration_seconds)}
                        </span>
                      )}
                    </div>
                    {recs.map(r => <SessionRow key={r.id} rec={r} />)}
                  </div>
                );
              })}
              {/* Orphan mixed tracks (no matching individuals) */}
              {sessions
                .filter(s => !sessionGroups.has(s.session_id || ""))
                .map(r => <SessionRow key={r.id} rec={r} />)}
            </div>
          )}

          <div className="p-4">
            <KGenButton
              onClick={() => navigate(`/campaign/${campaign.id}/task`)}
              className="w-full"
              size="sm"
              scrambleText="ENVIAR MAIS MATERIAIS"
              icon={<ArrowRight className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortalMyCampaigns() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: participations, isLoading } = useQuery({
    queryKey: ["my_campaigns", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("campaign_participants")
        .select("campaign_id, joined_at, status, campaigns:campaign_id(id, name, description, campaign_status, start_date, end_date)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const campaignIds = participations?.map((p: any) => p.campaign_id) || [];

  const { data: allRecordings } = useQuery({
    queryKey: ["my_campaign_recordings", campaignIds],
    queryFn: async () => {
      if (!campaignIds.length) return [];
      const { data, error } = await supabase
        .from("voice_recordings")
        .select("id, filename, duration_seconds, recording_type, session_id, created_at, discord_username, file_url, status, campaign_id")
        .in("campaign_id", campaignIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as (RecordingRow & { campaign_id: string })[];
    },
    enabled: campaignIds.length > 0,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" style={{ background: "var(--portal-card-bg)" }} />)}
      </div>
    );
  }

  if (!participations || participations.length === 0) {
    return (
      <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
        <FolderOpen className="h-8 w-8 mx-auto mb-4" style={{ color: "var(--portal-text-muted)" }} />
        <p className="font-mono text-base" style={{ color: "var(--portal-text-muted)" }}>
          Você ainda não participa de nenhuma campanha.
        </p>
        <button
          onClick={() => navigate("/")}
          className="font-mono text-sm uppercase tracking-widest mt-4 px-4 py-2 transition-colors"
          style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
        >
          Explorar Campanhas
        </button>
      </div>
    );
  }

  const recordingsByCampaign = (cid: string) =>
    (allRecordings || []).filter(r => r.campaign_id === cid);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          Minhas Campanhas
        </h1>
      </div>

      <div className="space-y-3">
        {participations.map((p: any) => (
          <CampaignCard
            key={p.campaign_id}
            participation={p}
            recordings={recordingsByCampaign(p.campaign_id)}
          />
        ))}
      </div>
    </div>
  );
}
