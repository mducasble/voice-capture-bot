import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Clock, FileAudio, Users, Play, Pause, ChevronDown,
  CheckCircle2, XCircle, AlertCircle,
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
  bit_depth: number | null;
  channels: number | null;
  format: string | null;
  file_size_bytes: number | null;
  transcription_status: string | null;
  metadata: {
    rms_level_db?: number;
    effective_bandwidth_hz?: number;
    srmr?: number;
    sigmos_sig?: number;
    sigmos_bak?: number;
    sigmos_ovrl?: number;
    wvmos?: number;
    analysis_mode?: string;
  } | null;
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

interface SessionGroup {
  sessionId: string;
  recordings: Recording[];
  mixed: Recording | undefined;
  individuals: Recording[];
  createdAt: string;
  topic: string | null;
  creatorName: string | null;
}

const REJECTION_REASONS = [
  "Número insuficiente de participantes",
  "Áudio abaixo do padrão mínimo de qualidade",
  "Desvio do tema superior a 20%",
  "Participante infringiu as regras de produção ou envio de material",
  "Duração menor que o tempo previsto",
  "Material inconsistente (Upload de arquivos de duração diferentes)",
  "Um dos participantes já ultrapassou a cota máxima dessa campanha",
];

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

// ---- Track Row (read-only, no individual approve buttons) ----

function TrackRow({ rec }: { rec: Recording }) {
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
    <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-3">
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
      {rec.transcription_status && (
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">
          TR: {rec.transcription_status}
        </span>
      )}
    </div>
  );
}

// ---- Session card with session-level approval ----

function SessionCard({
  session,
  profileMap,
  onApproveSession,
  onRejectSession,
  isPending,
}: {
  session: SessionGroup;
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const duration = session.mixed?.duration_seconds
    || Math.max(...session.individuals.map(r => r.duration_seconds || 0), 0);

  const recIds = session.recordings.map(r => r.id);

  // Derive overall session status
  const allApproved = session.recordings.every(r => r.quality_status === "approved" && r.validation_status === "approved");
  const anyRejected = session.recordings.some(r => r.quality_status === "rejected" || r.validation_status === "rejected");
  const sessionStatus = allApproved ? "approved" : anyRejected ? "rejected" : "pending";

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
            <StatusPill status={sessionStatus} />
            {session.topic && <span className="text-xs text-muted-foreground">· {session.topic}</span>}
            {session.creatorName && <span className="text-xs text-muted-foreground">· {session.creatorName}</span>}
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
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/30">
          {/* Tracks */}
          {session.mixed && (
            <div>
              <div className="px-4 py-1 bg-accent/5">
                <span className="font-mono text-[9px] uppercase tracking-widest text-accent">🎧 Áudio Combinado</span>
              </div>
              <TrackRow rec={session.mixed} />
            </div>
          )}
          {session.individuals.map(r => {
            const userName = r.user_id ? (profileMap.get(r.user_id) || r.discord_username || "Participante") : (r.discord_username || "Participante");
            return (
              <div key={r.id}>
                <div className="px-4 py-1 bg-secondary/30">
                  <span className="font-mono text-[10px] text-muted-foreground">👤 {userName}</span>
                </div>
                <TrackRow rec={r} />
              </div>
            );
          })}

          {/* Session-level approval controls */}
          {sessionStatus === "pending" && (
            <div className="p-4 border-t border-border/30 bg-secondary/10 space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-600"
                  disabled={isPending}
                  onClick={() => onApproveSession(recIds)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Aprovar sessão
                </Button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Select value={rejectionReason} onValueChange={setRejectionReason}>
                  <SelectTrigger className="w-full max-w-md text-xs h-8">
                    <SelectValue placeholder="Selecione o motivo da rejeição..." />
                  </SelectTrigger>
                  <SelectContent>
                    {REJECTION_REASONS.map(reason => (
                      <SelectItem key={reason} value={reason} className="text-xs">
                        {reason}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 shrink-0"
                  disabled={isPending || !rejectionReason}
                  onClick={() => {
                    onRejectSession(recIds, rejectionReason);
                    setRejectionReason("");
                  }}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Rejeitar sessão
                </Button>
              </div>
            </div>
          )}

          {/* Show rejection reason if already rejected */}
          {sessionStatus === "rejected" && (
            <div className="p-3 border-t border-border/30 bg-red-500/5">
              <span className="font-mono text-[10px] text-red-500">
                Rejeitado: {session.recordings[0]?.quality_rejection_reason || session.recordings[0]?.validation_rejection_reason || "—"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Campaign tab content ----

function CampaignTabContent({
  sessions,
  profileMap,
  onApproveSession,
  onRejectSession,
  isPending,
}: {
  sessions: SessionGroup[];
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  isPending: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 border border-border bg-card">
        <FileAudio className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhuma sessão nesta campanha.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map(session => (
        <SessionCard
          key={session.sessionId}
          session={session}
          profileMap={profileMap}
          onApproveSession={onApproveSession}
          onRejectSession={onRejectSession}
          isPending={isPending}
        />
      ))}
    </div>
  );
}

// ---- Main page ----

export default function ReviewQueue() {
  const queryClient = useQueryClient();

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

  const { campaignTabs, noCampaignSessions } = useMemo(() => {
    if (!recordings) return { campaignTabs: [], noCampaignSessions: [] };

    const byCampaign = new Map<string, Map<string, Recording[]>>();
    const noCampaignMap = new Map<string, Recording[]>();

    for (const r of recordings) {
      const sid = r.session_id || r.id;
      if (!r.campaign_id) {
        if (!noCampaignMap.has(sid)) noCampaignMap.set(sid, []);
        noCampaignMap.get(sid)!.push(r);
      } else {
        if (!byCampaign.has(r.campaign_id)) byCampaign.set(r.campaign_id, new Map());
        const sessionMap = byCampaign.get(r.campaign_id)!;
        if (!sessionMap.has(sid)) sessionMap.set(sid, []);
        sessionMap.get(sid)!.push(r);
      }
    }

    const buildSessions = (sessionMap: Map<string, Recording[]>): SessionGroup[] => {
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
      return sessions;
    };

    const tabs: { campaign: CampaignInfo; sessions: SessionGroup[]; pendingCount: number }[] = [];
    for (const [cid, sessionMap] of byCampaign) {
      const campaign = campaignMap.get(cid) || { id: cid, name: cid.slice(0, 8), description: null, campaign_type: null };
      const sessions = buildSessions(sessionMap);
      const pendingCount = sessions.filter(s =>
        s.recordings.some(r => r.quality_status === "pending" || r.validation_status === "pending")
      ).length;
      tabs.push({ campaign, sessions, pendingCount });
    }
    tabs.sort((a, b) => b.pendingCount - a.pendingCount);

    return {
      campaignTabs: tabs,
      noCampaignSessions: buildSessions(noCampaignMap),
    };
  }, [recordings, campaignMap, roomMap]);

  // Session-level approve mutation
  const approveSessionMutation = useMutation({
    mutationFn: async ({ recordingIds }: { recordingIds: string[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      for (const id of recordingIds) {
        const { error } = await supabase
          .from("voice_recordings")
          .update({
            quality_status: "approved",
            validation_status: "approved",
            quality_reviewed_at: now,
            validation_reviewed_at: now,
            quality_reviewed_by: user?.id || null,
            validation_reviewed_by: user?.id || null,
          } as any)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_review_queue"] });
      toast.success("Sessão aprovada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao aprovar"),
  });

  // Session-level reject mutation
  const rejectSessionMutation = useMutation({
    mutationFn: async ({ recordingIds, reason }: { recordingIds: string[]; reason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      for (const id of recordingIds) {
        const { error } = await supabase
          .from("voice_recordings")
          .update({
            quality_status: "rejected",
            validation_status: "rejected",
            quality_rejection_reason: reason,
            validation_rejection_reason: reason,
            quality_reviewed_at: now,
            validation_reviewed_at: now,
            quality_reviewed_by: user?.id || null,
            validation_reviewed_by: user?.id || null,
          } as any)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_review_queue"] });
      toast.success("Sessão rejeitada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao rejeitar"),
  });

  const handleApproveSession = (recordingIds: string[]) => {
    approveSessionMutation.mutate({ recordingIds });
  };

  const handleRejectSession = (recordingIds: string[], reason: string) => {
    rejectSessionMutation.mutate({ recordingIds, reason });
  };

  const isMutating = approveSessionMutation.isPending || rejectSessionMutation.isPending;
  const hasNoCampaign = noCampaignSessions.length > 0;
  const allTabs = campaignTabs;
  const defaultTab = allTabs.length > 0 ? allTabs[0].campaign.id : (hasNoCampaign ? "__none__" : "");

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Fila de Aprovação</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {allTabs.length} {allTabs.length === 1 ? "campanha" : "campanhas"}
          {hasNoCampaign && " + legados sem campanha"}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {!isLoading && allTabs.length === 0 && !hasNoCampaign && (
        <div className="text-center py-16 border border-border bg-card">
          <FileAudio className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Nenhuma sessão encontrada</h3>
          <p className="text-sm text-muted-foreground mt-1">As sessões enviadas pelo portal aparecerão aqui.</p>
        </div>
      )}

      {!isLoading && (allTabs.length > 0 || hasNoCampaign) && (
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="w-full flex-wrap h-auto gap-1 bg-secondary/50 p-1">
            {allTabs.map(({ campaign, pendingCount }) => (
              <TabsTrigger key={campaign.id} value={campaign.id} className="text-xs gap-1.5 data-[state=active]:bg-background">
                <span className="truncate max-w-[120px]">{campaign.name}</span>
                {pendingCount > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/40 text-amber-500 ml-1">
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
            {hasNoCampaign && (
              <TabsTrigger value="__none__" className="text-xs gap-1.5 data-[state=active]:bg-background text-muted-foreground">
                Sem campanha
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-border ml-1">
                  {noCampaignSessions.reduce((a, s) => a + s.recordings.length, 0)}
                </Badge>
              </TabsTrigger>
            )}
          </TabsList>

          {allTabs.map(({ campaign, sessions }) => (
            <TabsContent key={campaign.id} value={campaign.id} className="mt-4">
              <div className="mb-3">
                <h2 className="text-base font-bold text-foreground">{campaign.name}</h2>
                {campaign.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{campaign.description}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {sessions.length} {sessions.length === 1 ? "sessão" : "sessões"} · {sessions.reduce((a, s) => a + s.recordings.length, 0)} arquivos
                </p>
              </div>
              <CampaignTabContent
                sessions={sessions}
                profileMap={profileMap}
                onApproveSession={handleApproveSession}
                onRejectSession={handleRejectSession}
                isPending={isMutating}
              />
            </TabsContent>
          ))}

          {hasNoCampaign && (
            <TabsContent value="__none__" className="mt-4">
              <div className="mb-3">
                <h2 className="text-base font-bold text-foreground">Sem campanha</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Gravações legadas sem vínculo de campanha.</p>
              </div>
              <CampaignTabContent
                sessions={noCampaignSessions}
                profileMap={profileMap}
                onApproveSession={handleApproveSession}
                onRejectSession={handleRejectSession}
                isPending={isMutating}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
