import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  ArrowLeft, RotateCcw, Loader2, CheckCircle2, XCircle,
  Headphones, Clock, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataAudioPlayer } from "@/components/data/DataAudioPlayer";
import { RejectionReasonModal } from "@/components/audit/RejectionReasonModal";

interface Revision {
  id: string;
  session_id: string;
  user_id: string;
  campaign_id: string;
  status: string;
  notes: string | null;
  created_at: string;
  submitted_at: string | null;
}

interface SessionRec {
  id: string;
  filename: string;
  file_url: string | null;
  mp3_file_url?: string | null;
  duration_seconds: number | null;
  discord_username: string | null;
  recording_type: string | null;
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export default function DataRevisionQueue() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [sessionRecs, setSessionRecs] = useState<Record<string, SessionRec[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!campaignId) return;

    supabase
      .from("campaigns")
      .select("name")
      .eq("id", campaignId)
      .single()
      .then(({ data }) => setCampaignName(data?.name || ""));

    supabase
      .from("session_revisions")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true })
      .then(async ({ data, error }) => {
        if (error) { toast.error("Erro ao carregar revisões"); setLoading(false); return; }
        const revs = (data || []) as Revision[];
        setRevisions(revs);

        // Fetch recordings for each session
        const sessionIds = revs.map((r) => r.session_id);
        if (sessionIds.length > 0) {
          const { data: recsData } = await supabase
            .from("voice_recordings")
            .select("id, filename, file_url, mp3_file_url, duration_seconds, discord_username, recording_type, session_id")
            .in("session_id", sessionIds);

          const grouped: Record<string, SessionRec[]> = {};
          (recsData || []).forEach((r: any) => {
            (grouped[r.session_id] = grouped[r.session_id] || []).push(r);
          });
          setSessionRecs(grouped);

          // Fetch profile names
          const userIds = [...new Set(revs.map((r) => r.user_id))];
          const { data: profileData } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);
          const names: Record<string, string> = {};
          (profileData || []).forEach((p: any) => { names[p.id] = p.full_name; });
          setProfiles(names);
        }

        setLoading(false);
      });
  }, [campaignId]);

  const handleApprove = async (rev: Revision) => {
    setSaving(rev.id);

    // Approve all recordings in the session
    const { error: recError } = await supabase
      .from("voice_recordings")
      .update({
        quality_status: "approved",
        quality_reviewed_by: user?.id,
        quality_reviewed_at: new Date().toISOString(),
      })
      .eq("session_id", rev.session_id);

    // Mark revision as approved
    const { error: revError } = await supabase
      .from("session_revisions")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id,
      })
      .eq("id", rev.id);

    setSaving(null);
    if (recError || revError) { toast.error("Erro ao aprovar revisão"); return; }
    toast.success("Revisão aprovada!");
    setRevisions((prev) => prev.filter((r) => r.id !== rev.id));
  };

  const handleReject = async (reasons: string[], note: string) => {
    const reason = [reasons.join(", "), note].filter(Boolean).join(" — ");
    if (!rejectTarget) return;
    const rev = revisions.find((r) => r.id === rejectTarget);
    if (!rev) return;

    setSaving(rejectTarget);

    // Reject all recordings in the session
    const { error: recError } = await supabase
      .from("voice_recordings")
      .update({
        quality_status: "rejected",
        quality_rejection_reason: reason,
        quality_reviewed_by: user?.id,
        quality_reviewed_at: new Date().toISOString(),
      })
      .eq("session_id", rev.session_id);

    // Mark revision as rejected
    const { error: revError } = await supabase
      .from("session_revisions")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id,
      })
      .eq("id", rev.id);

    setSaving(null);
    setRejectTarget(null);
    if (recError || revError) { toast.error("Erro ao reprovar revisão"); return; }
    toast.success("Revisão reprovada.");
    setRevisions((prev) => prev.filter((r) => r.id !== rejectTarget));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <div className="flex items-center gap-3 mb-2">
        <RotateCcw className="h-6 w-6 text-violet-400" />
        <h1 className="text-[28px] font-bold text-white tracking-tight">Revisões</h1>
        <span className="text-[14px] text-white/30 font-medium ml-2">{campaignName}</span>
      </div>
      <p className="text-[15px] text-white/40 mb-8">{revisions.length} sessão(ões) resubmetida(s)</p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
        </div>
      ) : revisions.length === 0 ? (
        <div className="text-center py-20">
          <RotateCcw className="h-16 w-16 text-white/10 mx-auto mb-4" />
          <p className="text-[18px] text-white/30">Nenhuma revisão pendente</p>
        </div>
      ) : (
        <div className="space-y-6">
          {revisions.map((rev) => {
            const tracks = sessionRecs[rev.session_id] || [];
            const isSaving = saving === rev.id;
            const userName = profiles[rev.user_id] || "Usuário";

            return (
              <div key={rev.id} className="data-glass-card rounded-2xl p-5">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <RotateCcw className="h-5 w-5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[15px] font-semibold text-white truncate">{userName}</p>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md border bg-violet-500/20 text-violet-400 border-violet-500/30">
                        Revisão
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[13px] text-white/30">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Enviado {rev.submitted_at ? new Date(rev.submitted_at).toLocaleDateString("pt-BR") : "—"}
                      </span>
                      <span>{tracks.length} trilha(s)</span>
                    </div>
                  </div>
                </div>

                {rev.notes && (
                  <div className="mb-4 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-[13px] text-white/60">
                    <span className="text-white/30 font-semibold text-[11px] uppercase tracking-wider block mb-1">Nota do usuário</span>
                    {rev.notes}
                  </div>
                )}

                {/* Tracks */}
                <div className="space-y-3 mb-4">
                  {tracks.map((t) => {
                    const audioUrl = t.mp3_file_url || t.file_url;
                    return (
                      <div key={t.id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                        <div className="flex items-center gap-3 mb-2">
                          <Headphones className="h-4 w-4 text-white/30" />
                          <span className="text-[14px] font-medium text-white/80">
                            {t.recording_type === "mixed" ? "Mixed" : t.discord_username || "Speaker"}
                          </span>
                          <span className="text-[12px] text-white/30">{formatTime(t.duration_seconds || 0)}</span>
                        </div>
                        {audioUrl && <DataAudioPlayer src={audioUrl} />}
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={isSaving}
                    onClick={() => handleApprove(rev)}
                    className="h-9 px-4 text-[13px] rounded-xl gap-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/20 font-semibold"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar Sessão
                  </Button>
                  <Button
                    size="sm"
                    disabled={isSaving}
                    onClick={() => setRejectTarget(rev.id)}
                    className="h-9 px-4 text-[13px] rounded-xl gap-1.5 bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/20 font-semibold"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Reprovar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {campaignId && (
        <RejectionReasonModal
          open={!!rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={handleReject}
          campaignId={campaignId}
          useAdminReasons
        />
      )}
    </div>
  );
}
