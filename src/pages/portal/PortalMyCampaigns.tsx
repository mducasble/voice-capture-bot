import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen, FileAudio, Clock, ChevronDown, Play, Pause, ArrowRight, CheckCircle, XCircle, Loader2, Signal, Video, Image, FileText, Tag } from "lucide-react";
import { ResendAudioButton } from "@/components/portal/ResendAudioButton";
import { SessionBlock } from "@/components/portal/SessionBlock";
import KGenButton from "@/components/portal/KGenButton";
import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

// Unified submission row that works for all submission types
interface SubmissionRow {
  id: string;
  filename: string;
  duration_seconds: number | null;
  recording_type: string | null; // 'individual' | 'mixed' for audio; null for others
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
  submission_type: "audio" | "video" | "image" | "text" | "annotation";
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function getUnifiedStatus(rec: SubmissionRow): { label: string; color: string; bg: string; icon: React.ReactNode; reason?: string | null } {
  const qa = rec.quality_status;
  const val = rec.validation_status;

  if (qa === "rejected" || val === "rejected") {
    const reason = rec.quality_rejection_reason || rec.validation_rejection_reason;
    return {
      label: reason ? `Reprovado: ${reason}` : "Reprovado",
      color: "#ef4444",
      bg: "rgba(239,68,68,0.15)",
      icon: <XCircle className="h-3.5 w-3.5" />,
      reason,
    };
  }

  if ((qa === "approved" || qa === "validated") && (val === "approved" || val === "validated")) {
    return {
      label: "Aprovado",
      color: "#22c55e",
      bg: "rgba(34,197,94,0.15)",
      icon: <CheckCircle className="h-3.5 w-3.5" />,
    };
  }

  return {
    label: "Em análise",
    color: "var(--portal-text-muted)",
    bg: "rgba(255,255,255,0.05)",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  };
}

const SUBMISSION_TYPE_ICON: Record<string, React.ReactNode> = {
  audio: <FileAudio className="h-3.5 w-3.5" />,
  video: <Video className="h-3.5 w-3.5" />,
  image: <Image className="h-3.5 w-3.5" />,
  text: <FileText className="h-3.5 w-3.5" />,
  annotation: <Tag className="h-3.5 w-3.5" />,
};

const SUBMISSION_TYPE_LABEL: Record<string, string> = {
  audio: "Áudio",
  video: "Vídeo",
  image: "Imagem",
  text: "Texto",
  annotation: "Anotação",
};

function SubmissionRowItem({ rec }: { rec: SubmissionRow }) {
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

  const isAudio = rec.submission_type === "audio";
  const isMixed = rec.recording_type === "mixed";

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 flex-wrap" style={{ borderBottom: "1px solid var(--portal-border)" }}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {isAudio && rec.file_url && (
          <button onClick={toggle} className="shrink-0" style={{ color: "var(--portal-accent)" }}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}
        {!isAudio && (
          <span className="shrink-0" style={{ color: "var(--portal-accent)" }}>
            {SUBMISSION_TYPE_ICON[rec.submission_type]}
          </span>
        )}
        <span className="font-mono text-base truncate block" style={{ color: isMixed ? "var(--portal-accent)" : "var(--portal-text)" }}>
          {isMixed ? "🎧 Áudio Combinado" : (rec.discord_username || rec.filename)}
        </span>
        {!isAudio && (
          <span className="font-mono text-xs uppercase tracking-widest px-1.5 py-0.5 shrink-0" style={{ background: "rgba(255,255,255,0.05)", color: "var(--portal-text-muted)", border: "1px solid var(--portal-border)" }}>
            {SUBMISSION_TYPE_LABEL[rec.submission_type]}
          </span>
        )}
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
        {(() => {
          const s = getUnifiedStatus(rec);
          return (
            <span
              className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest px-2 py-0.5"
              style={{ color: s.color, background: s.bg }}
              title={s.reason || undefined}
            >
              {s.icon} {s.label}
            </span>
          );
        })()}
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

function CampaignStatusSummary({ submissions }: { submissions: SubmissionRow[] }) {
  // Count non-mixed items for status summary
  const countable = submissions.filter(r => r.recording_type !== "mixed");
  if (countable.length === 0) return null;

  const approved = countable.filter(r => getUnifiedStatus(r).label === "Aprovado").length;
  const rejected = countable.filter(r => getUnifiedStatus(r).label.startsWith("Reprovado")).length;
  const pending = countable.length - approved - rejected;

  return (
    <div className="px-4 py-3.5 flex items-center justify-end gap-3 flex-wrap" style={{ background: "rgba(0,0,0,0.1)", borderBottom: "1px solid var(--portal-border)" }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--portal-border)" }}>
        <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>Status</span>
        <div className="flex items-center gap-1.5">
          {approved > 0 && (
            <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold px-1.5 py-0.5" style={{ color: "#22c55e", background: "rgba(34,197,94,0.15)" }}>
              <CheckCircle className="h-3 w-3" /> {approved}
            </span>
          )}
          {rejected > 0 && (
            <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold px-1.5 py-0.5" style={{ color: "#ef4444", background: "rgba(239,68,68,0.15)" }}>
              <XCircle className="h-3 w-3" /> {rejected}
            </span>
          )}
          {pending > 0 && (
            <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold px-1.5 py-0.5" style={{ color: "var(--portal-text-muted)", background: "rgba(255,255,255,0.05)" }}>
              <Loader2 className="h-3 w-3 animate-spin" /> {pending}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignCard({ participation, submissions }: { participation: any; submissions: SubmissionRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const campaign = participation.campaigns;
  if (!campaign) return null;

  // Audio-specific grouping
  const audioSubmissions = submissions.filter(s => s.submission_type === "audio");
  const nonAudioSubmissions = submissions.filter(s => s.submission_type !== "audio");

  const sessions = audioSubmissions.filter(r => r.recording_type === "mixed");
  const audioIndividuals = audioSubmissions.filter(r => r.recording_type === "individual");

  const totalAudioDuration = sessions.reduce((s, r) => s + (r.duration_seconds || 0), 0)
    || audioIndividuals.reduce((s, r) => Math.max(s, r.duration_seconds || 0), 0);

  // Group audio by session
  const sessionGroups = new Map<string, SubmissionRow[]>();
  for (const r of audioSubmissions) {
    const key = r.session_id || r.id;
    if (!sessionGroups.has(key)) sessionGroups.set(key, []);
    sessionGroups.get(key)!.push(r);
  }

  // Count totals per type for header
  const typeCounts = new Map<string, number>();
  for (const s of submissions) {
    if (s.recording_type === "mixed") continue;
    typeCounts.set(s.submission_type, (typeCounts.get(s.submission_type) || 0) + 1);
  }

  // Overall validation
  const countable = submissions.filter(r => r.recording_type !== "mixed");
  const allValidated = countable.length > 0 && countable.every(r => getUnifiedStatus(r).label === "Aprovado");
  const hasRejected = countable.some(r => getUnifiedStatus(r).label.startsWith("Reprovado"));

  return (
    <div style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-5 flex items-center justify-between gap-4 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-base font-bold uppercase tracking-tight truncate" style={{ color: "var(--portal-text)" }}>
              {campaign.name}
            </h2>
            {allValidated && countable.length > 0 && (
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
            {Array.from(typeCounts.entries()).map(([type, count]) => (
              <span key={type} className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                {SUBMISSION_TYPE_ICON[type]}
                {count} {SUBMISSION_TYPE_LABEL[type]}
              </span>
            ))}
            {totalAudioDuration > 0 && (
              <span className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                <Clock className="h-3.5 w-3.5" />
                {formatDuration(totalAudioDuration)}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: "var(--portal-text-muted)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--portal-border)" }}>
          {submissions.length === 0 ? (
            <div className="p-6 text-center">
              <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>{t("myCampaigns.noMaterial")}</p>
            </div>
          ) : (
            <div>
              <CampaignStatusSummary submissions={submissions} />

              {/* Audio sessions grouped */}
              {Array.from(sessionGroups.entries()).map(([sessionId, recs]) => {
                const sessionDuration = recs.find(r => r.recording_type === "mixed")?.duration_seconds
                  ?? recs.reduce((s, r) => Math.max(s, r.duration_seconds || 0), 0);
                return (
                  <div key={sessionId}>
                    <div className="px-4 py-2 flex items-center gap-2 flex-wrap" style={{ background: "rgba(0,0,0,0.15)" }}>
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
                      <ResendAudioButton sessionId={sessionId} campaignId={campaign.id} />
                    </div>
                    {recs.map(r => <SubmissionRowItem key={r.id} rec={r} />)}
                    <SessionManualUpload sessionId={sessionId} campaignId={campaign.id} />
                  </div>
                );
              })}

              {/* Non-audio submissions (videos, images, etc.) */}
              {nonAudioSubmissions.length > 0 && (
                <div>
                  {audioSubmissions.length > 0 && (
                    <div className="px-4 py-2 flex items-center gap-2" style={{ background: "rgba(0,0,0,0.15)" }}>
                      <span className="font-mono text-sm uppercase tracking-widest font-bold" style={{ color: "var(--portal-accent)" }}>
                        Outros envios
                      </span>
                    </div>
                  )}
                  {nonAudioSubmissions.map(r => <SubmissionRowItem key={r.id} rec={r} />)}
                </div>
              )}
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

  // Fetch all submission types in parallel
  const { data: allSubmissions } = useQuery({
    queryKey: ["my_campaign_all_submissions", campaignIds],
    queryFn: async (): Promise<SubmissionRow[]> => {
      if (!campaignIds.length || !user?.id) return [];

      const [audioRes, videoRes, imageRes, textRes, annotationRes] = await Promise.all([
        // Audio via RPC
        supabase.rpc("get_my_campaign_recordings", {
          p_user_id: user.id,
          p_campaign_ids: campaignIds,
        }),
        // Videos
        supabase
          .from("video_submissions")
          .select("id, campaign_id, filename, file_url, duration_seconds, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, created_at")
          .eq("user_id", user.id)
          .in("campaign_id", campaignIds)
          .order("created_at", { ascending: false }),
        // Images
        supabase
          .from("image_submissions")
          .select("id, campaign_id, filename, file_url, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, created_at")
          .eq("user_id", user.id)
          .in("campaign_id", campaignIds)
          .order("created_at", { ascending: false }),
        // Text
        supabase
          .from("text_submissions")
          .select("id, campaign_id, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, created_at")
          .eq("user_id", user.id)
          .in("campaign_id", campaignIds)
          .order("created_at", { ascending: false }),
        // Annotations
        supabase
          .from("annotation_submissions")
          .select("id, campaign_id, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, created_at")
          .eq("user_id", user.id)
          .in("campaign_id", campaignIds)
          .order("created_at", { ascending: false }),
      ]);

      const results: SubmissionRow[] = [];

      // Audio recordings
      for (const r of (audioRes.data || [])) {
        if (r.recording_type === "remote_backup") continue;
        results.push({
          id: r.id,
          filename: r.filename,
          duration_seconds: r.duration_seconds,
          recording_type: r.recording_type,
          session_id: r.session_id,
          created_at: r.created_at,
          discord_username: r.discord_username,
          file_url: r.file_url,
          status: r.status,
          quality_status: r.quality_status,
          validation_status: r.validation_status,
          snr_db: r.snr_db,
          quality_rejection_reason: r.quality_rejection_reason,
          validation_rejection_reason: r.validation_rejection_reason,
          campaign_id: r.campaign_id,
          submission_type: "audio",
        });
      }

      // Videos
      for (const v of (videoRes.data || [])) {
        results.push({
          id: v.id,
          filename: v.filename,
          duration_seconds: v.duration_seconds,
          recording_type: null,
          session_id: null,
          created_at: v.created_at,
          discord_username: null,
          file_url: v.file_url,
          status: null,
          quality_status: v.quality_status,
          validation_status: v.validation_status,
          snr_db: null,
          quality_rejection_reason: v.quality_rejection_reason,
          validation_rejection_reason: v.validation_rejection_reason,
          campaign_id: v.campaign_id,
          submission_type: "video",
        });
      }

      // Images
      for (const img of (imageRes.data || [])) {
        results.push({
          id: img.id,
          filename: img.filename,
          duration_seconds: null,
          recording_type: null,
          session_id: null,
          created_at: img.created_at,
          discord_username: null,
          file_url: img.file_url,
          status: null,
          quality_status: img.quality_status,
          validation_status: img.validation_status,
          snr_db: null,
          quality_rejection_reason: img.quality_rejection_reason,
          validation_rejection_reason: img.validation_rejection_reason,
          campaign_id: img.campaign_id,
          submission_type: "image",
        });
      }

      // Text
      for (const txt of (textRes.data || [])) {
        results.push({
          id: txt.id,
          filename: `Texto #${txt.id.slice(0, 6)}`,
          duration_seconds: null,
          recording_type: null,
          session_id: null,
          created_at: txt.created_at,
          discord_username: null,
          file_url: null,
          status: null,
          quality_status: txt.quality_status,
          validation_status: txt.validation_status,
          snr_db: null,
          quality_rejection_reason: txt.quality_rejection_reason,
          validation_rejection_reason: txt.validation_rejection_reason,
          campaign_id: txt.campaign_id,
          submission_type: "text",
        });
      }

      // Annotations
      for (const ann of (annotationRes.data || [])) {
        results.push({
          id: ann.id,
          filename: `Anotação #${ann.id.slice(0, 6)}`,
          duration_seconds: null,
          recording_type: null,
          session_id: null,
          created_at: ann.created_at,
          discord_username: null,
          file_url: null,
          status: null,
          quality_status: ann.quality_status,
          validation_status: ann.validation_status,
          snr_db: null,
          quality_rejection_reason: ann.quality_rejection_reason,
          validation_rejection_reason: ann.validation_rejection_reason,
          campaign_id: ann.campaign_id,
          submission_type: "annotation",
        });
      }

      return results;
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

  const submissionsByCampaign = (cid: string) => (allSubmissions || []).filter(r => r.campaign_id === cid);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>{t("myCampaigns.title")}</h1>
      </div>

      <div className="space-y-3">
        {participations.map((p: any) => (
          <CampaignCard key={p.campaign_id} participation={p} submissions={submissionsByCampaign(p.campaign_id)} />
        ))}
      </div>
    </div>
  );
}
