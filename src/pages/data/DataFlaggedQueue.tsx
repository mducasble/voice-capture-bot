import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  ArrowLeft, Flag, Loader2, CheckCircle2, XCircle, RotateCcw,
  Headphones, User, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataAudioPlayer } from "@/components/data/DataAudioPlayer";
import { RejectionReasonModal } from "@/components/audit/RejectionReasonModal";
import { cn } from "@/lib/utils";

interface FlaggedRec {
  id: string;
  filename: string;
  file_url: string | null;
  mp3_file_url?: string | null;
  duration_seconds: number | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  recording_type: string | null;
  quality_status: string | null;
  flag_reason: string | null;
  user_id: string | null;
  campaign_id: string | null;
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export default function DataFlaggedQueue() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recs, setRecs] = useState<FlaggedRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;

    supabase
      .from("campaigns")
      .select("name")
      .eq("id", campaignId)
      .single()
      .then(({ data }) => setCampaignName(data?.name || ""));

    supabase
      .from("voice_recordings")
      .select("id, filename, file_url, mp3_file_url, duration_seconds, session_id, created_at, discord_username, recording_type, quality_status, flag_reason, user_id, campaign_id")
      .eq("campaign_id", campaignId)
      .eq("quality_status", "flagged")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error("Erro ao carregar flags");
        setRecs((data as any[]) || []);
        setLoading(false);
      });
  }, [campaignId]);

  const handleApprove = async (rec: FlaggedRec) => {
    setSaving(rec.id);
    const { error } = await supabase
      .from("voice_recordings")
      .update({ quality_status: "approved", flag_reason: null })
      .eq("id", rec.id);
    setSaving(null);
    if (error) { toast.error("Erro ao aprovar"); return; }
    toast.success("Aprovado!");
    setRecs((prev) => prev.filter((r) => r.id !== rec.id));
  };

  const handleReturnToQueue = async (rec: FlaggedRec) => {
    setSaving(rec.id);
    const { error } = await supabase
      .from("voice_recordings")
      .update({ quality_status: "pending", flag_reason: null })
      .eq("id", rec.id);
    setSaving(null);
    if (error) { toast.error("Erro ao devolver"); return; }
    toast.success("Devolvido para fila de pendentes.");
    setRecs((prev) => prev.filter((r) => r.id !== rec.id));
  };

  const handleReject = async (reason: string) => {
    if (!rejectTarget) return;
    setSaving(rejectTarget);
    const { error } = await supabase
      .from("voice_recordings")
      .update({
        quality_status: "rejected",
        quality_rejection_reason: reason,
        quality_reviewed_by: user?.id,
        quality_reviewed_at: new Date().toISOString(),
      })
      .eq("id", rejectTarget);
    setSaving(null);
    setRejectTarget(null);
    if (error) { toast.error("Erro ao reprovar"); return; }
    toast.success("Reprovado.");
    setRecs((prev) => prev.filter((r) => r.id !== rejectTarget));
  };

  // Group by flag_reason
  const grouped = recs.reduce<Record<string, FlaggedRec[]>>((acc, r) => {
    const key = r.flag_reason || "Sem motivo";
    (acc[key] = acc[key] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <div className="flex items-center gap-3 mb-2">
        <Flag className="h-6 w-6 text-amber-400" />
        <h1 className="text-[28px] font-bold text-white tracking-tight">Flags</h1>
        <span className="text-[14px] text-white/30 font-medium ml-2">{campaignName}</span>
      </div>
      <p className="text-[15px] text-white/40 mb-8">{recs.length} registro(s) flagueado(s)</p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        </div>
      ) : recs.length === 0 ? (
        <div className="text-center py-20">
          <Flag className="h-16 w-16 text-white/10 mx-auto mb-4" />
          <p className="text-[18px] text-white/30">Nenhum flag pendente</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([reason, items]) => (
            <div key={reason}>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[13px] font-bold uppercase tracking-wider text-amber-400/70">{reason}</span>
                <span className="text-[12px] text-white/30">({items.length})</span>
              </div>
              <div className="space-y-3">
                {items.map((rec) => {
                  const audioUrl = (rec as any).mp3_file_url || rec.file_url;
                  const isSaving = saving === rec.id;

                  return (
                    <div key={rec.id} className="data-glass-card rounded-2xl p-5">
                      <div className="flex items-center gap-4 mb-3">
                        <div className="h-10 w-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
                          <Headphones className="h-5 w-5 text-white/40" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[15px] font-semibold text-white truncate">
                              {rec.recording_type === "mixed" ? "Mixed" : rec.discord_username || "Speaker"}
                            </p>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md border bg-amber-500/20 text-amber-400 border-amber-500/30">
                              {rec.recording_type || "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[13px] text-white/30">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTime(rec.duration_seconds || 0)}</span>
                            <span>{new Date(rec.created_at).toLocaleDateString("pt-BR")}</span>
                          </div>
                        </div>
                      </div>

                      {audioUrl && (
                        <div className="mb-4">
                          <DataAudioPlayer src={audioUrl} />
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={isSaving}
                          onClick={() => handleApprove(rec)}
                          className="h-9 px-4 text-[13px] rounded-xl gap-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/20 font-semibold"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
                        </Button>
                        <Button
                          size="sm"
                          disabled={isSaving}
                          onClick={() => handleReturnToQueue(rec)}
                          className="h-9 px-4 text-[13px] rounded-xl gap-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/20 font-semibold"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Devolver
                        </Button>
                        <Button
                          size="sm"
                          disabled={isSaving}
                          onClick={() => setRejectTarget(rec.id)}
                          className="h-9 px-4 text-[13px] rounded-xl gap-1.5 bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/20 font-semibold"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reprovar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
