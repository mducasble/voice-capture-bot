import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen, FileAudio, Clock, ChevronDown, Play, Pause, ArrowRight, CheckCircle, XCircle, AlertCircle, Loader2, Signal } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";
import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

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
  quality_status: string | null;
  validation_status: string | null;
  snr_db: number | null;
  quality_rejection_reason: string | null;
  validation_rejection_reason: string | null;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function StatusBadge({ label, status, reason }: { label: string; status: string | null; reason?: string | null }) {
  const config: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
    validated: { icon: <CheckCircle className="h-3.5 w-3.5" />, color: "#22c55e", bg: "rgba(34,197,94,0.15)" },
    approved: { icon: <CheckCircle className="h-3.5 w-3.5" />, color: "#22c55e", bg: "rgba(34,197,94,0.15)" },
    rejected: { icon: <XCircle className="h-3.5 w-3.5" />, color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
    failed: { icon: <XCircle className="h-3.5 w-3.5" />, color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
    pending: { icon: <AlertCircle className="h-3.5 w-3.5" />, color: "var(--portal-text-muted)", bg: "rgba(255,255,255,0.05)" },
    processing: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: "var(--portal-accent)", bg: "rgba(255,255,255,0.05)" },
  };
  const s = status || "pending";
  const c = config[s] || config.pending;

  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest px-2 py-0.5"
      style={{ color: c.color, background: c.bg }}
      title={reason || undefined}
    >
      {c.icon} {label}
    </span>
  );
}

function SessionRow({ rec }: { rec: RecordingRow & { campaign_id?: string } }) {
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
    <div className="flex items-center gap-3 px-4 py-3.5 flex-wrap" style={{ borderBottom: "1px solid var(--portal-border)" }}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {rec.file_url && (
          <button onClick={toggle} className="shrink-0" style={{ color: "var(--portal-accent)" }}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}
        <span className="font-mono text-base truncate block" style={{ color: rec.recording_type === "mixed" ? "var(--portal-accent)" : "var(--portal-text)" }}>
          {rec.recording_type === "mixed" ? "🎧 Áudio Combinado" : (rec.discord_username || rec.filename)}
        </span>
      </div>
      <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
        {rec.snr_db != null && (
          <span
            className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest px-2 py-0.5"
            style={{
              color: rec.snr_db >= 25 ? "#22c55e" : rec.snr_db >= 15 ? "#eab308" : "#ef4444",
              background: rec.snr_db >= 25 ? "rgba(34,197,94,0.15)" : rec.snr_db >= 15 ? "rgba(234,179,8,0.15)" : "rgba(239,68,68,0.15)",
            }}
          >
            <Signal className="h-3.5 w-3.5" /> {rec.snr_db.toFixed(1)}dB
          </span>
        )}
        <StatusBadge label="QA" status={rec.quality_status} reason={rec.quality_rejection_reason} />
        <StatusBadge label="Val" status={rec.validation_status} reason={rec.validation_rejection_reason} />
        {rec.duration_seconds != null && (
          <span className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
            {formatDuration(rec.duration_seconds)}
          </span>
        )}
        <span className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
          {new Date(rec.created_at).toLocaleDateString("pt-BR")}
        </span>
      </div>
    </div>
  );
}

function CampaignStatusSummary({ recordings }: { recordings: RecordingRow[] }) {
  const individuals = recordings.filter(r => r.recording_type === "individual");

  const countByStatus = (field: "quality_status" | "validation_status") => {
    return {
      validated: individuals.filter(r => r[field] === "validated" || r[field] === "approved").length,
      rejected: individuals.filter(r => r[field] === "rejected" || r[field] === "failed").length,
      pending: individuals.filter(r => !r[field] || r[field] === "pending" || r[field] === "processing").length,
    };
  };

  const qa = countByStatus("quality_status");
  const val = countByStatus("validation_status");

  if (individuals.length === 0) return null;

  const StatusPill = ({ label, counts }: { label: string; counts: { validated: number; rejected: number; pending: number } }) => (
    <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--portal-border)" }}>
      <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>{label}</span>
      <div className="flex items-center gap-1.5">
        {counts.validated > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold px-1.5 py-0.5" style={{ color: "#22c55e", background: "rgba(34,197,94,0.15)" }}>
            <CheckCircle className="h-3 w-3" /> {counts.validated}
          </span>
        )}
        {counts.rejected > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold px-1.5 py-0.5" style={{ color: "#ef4444", background: "rgba(239,68,68,0.15)" }}>
            <XCircle className="h-3 w-3" /> {counts.rejected}
          </span>
        )}
        {counts.pending > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold px-1.5 py-0.5" style={{ color: "var(--portal-text-muted)", background: "rgba(255,255,255,0.05)" }}>
            <AlertCircle className="h-3 w-3" /> {counts.pending}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="px-4 py-3.5 flex items-center justify-end gap-3 flex-wrap" style={{ background: "rgba(0,0,0,0.1)", borderBottom: "1px solid var(--portal-border)" }}>
      <StatusPill label="QA" counts={qa} />
      <StatusPill label="Val" counts={val} />
    </div>
  );
}

function CampaignCard({ participation, recordings }: { participation: any; recordings: RecordingRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const campaign = participation.campaigns;
  if (!campaign) return null;

  const sessions = recordings.filter(r => r.recording_type === "mixed");
  const individuals = recordings.filter(r => r.recording_type === "individual");
  const totalDuration = sessions.reduce((s, r) => s + (r.duration_seconds || 0), 0)
    || individuals.reduce((s, r) => Math.max(s, r.duration_seconds || 0), 0);

  const sessionGroups = new Map<string, RecordingRow[]>();
  for (const r of recordings) {
    const key = r.session_id || r.id;
    if (!sessionGroups.has(key)) sessionGroups.set(key, []);
    sessionGroups.get(key)!.push(r);
  }

  // Overall validation summary for header
  const allIndividuals = individuals;
  const allValidated = allIndividuals.length > 0 && allIndividuals.every(r => r.validation_status === "validated" || r.validation_status === "approved");
  const hasRejected = allIndividuals.some(r => r.quality_status === "rejected" || r.validation_status === "rejected");

  return (
    <div style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-5 flex items-center justify-between gap-4 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-base font-bold uppercase tracking-tight truncate" style={{ color: "var(--portal-text)" }}>
              {campaign.name}
            </h2>
            {allValidated && allIndividuals.length > 0 && (
              <CheckCircle className="h-4 w-4 shrink-0" style={{ color: "#22c55e" }} />
            )}
            {hasRejected && !allValidated && (
              <XCircle className="h-4 w-4 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
            )}
          </div>
          {campaign.description && (
            <p className="font-mono text-sm mt-1 truncate" style={{ color: "var(--portal-text-muted)" }}>{campaign.description}</p>
          )}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              {t("myCampaigns.since")} {new Date(participation.joined_at).toLocaleDateString("pt-BR")}
            </span>
            {sessions.length > 0 && (
              <span className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                <FileAudio className="h-3.5 w-3.5" />
                {sessions.length} {sessions.length === 1 ? t("myCampaigns.session") : t("myCampaigns.sessions")}
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
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: "var(--portal-text-muted)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--portal-border)" }}>
          {recordings.length === 0 ? (
            <div className="p-6 text-center">
              <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>{t("myCampaigns.noMaterial")}</p>
            </div>
          ) : (
            <div>
              <CampaignStatusSummary recordings={recordings} />
              {Array.from(sessionGroups.entries()).map(([sessionId, recs]) => {
                const sessionDuration = recs.find(r => r.recording_type === "mixed")?.duration_seconds
                  ?? recs.reduce((s, r) => Math.max(s, r.duration_seconds || 0), 0);
                return (
                  <div key={sessionId}>
                    <div className="px-4 py-2 flex items-center gap-2" style={{ background: "rgba(0,0,0,0.15)" }}>
                      <span className="font-mono text-sm uppercase tracking-widest font-bold" style={{ color: "var(--portal-accent)" }}>
                        {t("myCampaigns.session")}{" "}
                        <span className="px-1.5 py-0.5" style={{ background: "var(--portal-border)", color: "var(--portal-text)" }}>
                          {sessionId.slice(0, 8)}
                        </span>
                        {" "}— {new Date(recs[0].created_at).toLocaleDateString("pt-BR")}
                      </span>
                      {sessionDuration > 0 && (
                        <span className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>{formatDuration(sessionDuration)}</span>
                      )}
                    </div>
                    {recs.map(r => <SessionRow key={r.id} rec={r} />)}
                  </div>
                );
              })}
            </div>
          )}

          <div className="p-4">
            <KGenButton onClick={() => navigate(`/campaign/${campaign.id}/task`)} className="w-full" size="sm" scrambleText={t("task.sendMore")} icon={<ArrowRight className="h-3.5 w-3.5" />} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortalMyCampaigns() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

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
        .rpc("get_my_campaign_recordings", {
          p_user_id: user!.id,
          p_campaign_ids: campaignIds,
        });
      if (error) throw error;
      // Filter out remote_backup recordings (creator-side redundancy, admin-only)
      return ((data || []) as (RecordingRow & { campaign_id: string })[]).filter(
        r => r.recording_type !== 'remote_backup'
      );
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
        <p className="font-mono text-base" style={{ color: "var(--portal-text-muted)" }}>{t("myCampaigns.noCampaigns")}</p>
        <button onClick={() => navigate("/")} className="font-mono text-sm uppercase tracking-widest mt-4 px-4 py-2 transition-colors" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>
          {t("myCampaigns.exploreCampaigns")}
        </button>
      </div>
    );
  }

  const recordingsByCampaign = (cid: string) => (allRecordings || []).filter(r => r.campaign_id === cid);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>{t("myCampaigns.title")}</h1>
      </div>

      <div className="space-y-3">
        {participations.map((p: any) => (
          <CampaignCard key={p.campaign_id} participation={p} recordings={recordingsByCampaign(p.campaign_id)} />
        ))}
      </div>
    </div>
  );
}
