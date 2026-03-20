import { useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Film, User, Clock, CheckCircle2, XCircle,
  SkipForward, Loader2, FileText, Download, ExternalLink,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ---- Types ----

interface VideoSubmission {
  id: string;
  campaign_id: string;
  user_id: string;
  filename: string;
  file_url: string | null;
  file_size_bytes: number | null;
  format: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  quality_status: string | null;
  validation_status: string | null;
  quality_rejection_reason: string | null;
  validation_rejection_reason: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

interface TextSubmission {
  id: string;
  content: string | null;
  quality_status: string | null;
  validation_status: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

type OverallStatus = "pending" | "approved" | "rejected";

const REJECTION_REASONS = [
  "Arquivo corrompido ou ilegível",
  "Qualidade abaixo do padrão mínimo",
  "Conteúdo não corresponde à campanha",
  "Formato inválido",
  "Duração fora do esperado",
  "Conteúdo inapropriado",
  "Item de Teste",
];

// ---- Helpers ----

function getStatus(item: { quality_status: string | null; validation_status: string | null }): OverallStatus {
  if (item.quality_status === "approved" && item.validation_status === "approved") return "approved";
  if (item.quality_status === "rejected" || item.validation_status === "rejected") return "rejected";
  return "pending";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min ${Math.round(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function StatusPill({ status }: { status: OverallStatus }) {
  const map: Record<OverallStatus, { bg: string; fg: string; label: string }> = {
    pending: { bg: "rgba(234,179,8,0.15)", fg: "rgb(234,179,8)", label: "Pendente" },
    approved: { bg: "rgba(34,197,94,0.15)", fg: "rgb(34,197,94)", label: "Aprovado" },
    rejected: { bg: "rgba(239,68,68,0.15)", fg: "rgb(239,68,68)", label: "Rejeitado" },
  };
  const s = map[status];
  return (
    <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold"
      style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

// ---- Grouped pair card (video_prompt_pair) ----

function PairCard({
  videos,
  text,
  profileName,
  onApproveAll,
  onRejectAll,
  isMutating,
}: {
  videos: VideoSubmission[];
  text: TextSubmission | null;
  profileName: string;
  onApproveAll: (ids: string[], textId?: string) => void;
  onRejectAll: (ids: string[], reason: string, textId?: string) => void;
  isMutating: boolean;
}) {
  const [rejectionReason, setRejectionReason] = useState("");

  const original = videos.find(v => v.metadata?.video_role === "original");
  const modified = videos.find(v => v.metadata?.video_role === "modified");
  const allPending = videos.every(v => getStatus(v) === "pending") && (!text || getStatus(text) === "pending");
  const overallStatus = allPending ? "pending" : videos.some(v => getStatus(v) === "rejected") ? "rejected" : "approved";
  const senderName = videos[0]?.metadata?.sender_name || profileName;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <StatusPill status={overallStatus} />
        <span className="flex items-center gap-1 text-sm text-white/60">
          <User className="h-3.5 w-3.5" /> {senderName}
        </span>
        <span className="text-xs text-white/30 ml-auto">
          {new Date(videos[0]?.created_at).toLocaleDateString("pt-BR")}{" "}
          {new Date(videos[0]?.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Videos side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Original */}
        <div>
          <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-2">
            <Film className="h-3 w-3 inline mr-1" /> Vídeo Original
          </p>
          {original?.file_url ? (
            <>
              <video src={original.file_url} controls className="w-full rounded-xl bg-black/40 max-h-56 object-contain" />
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/30 font-mono">
                {original.duration_seconds && <span>{formatDuration(original.duration_seconds)}</span>}
                {original.width && original.height && <span>{original.width}×{original.height}</span>}
                {original.file_size_bytes && <span>{formatBytes(original.file_size_bytes)}</span>}
                <a href={original.file_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-white/60">
                  <ExternalLink className="h-3 w-3" /> Abrir
                </a>
              </div>
            </>
          ) : (
            <div className="h-32 rounded-xl bg-white/[0.04] flex items-center justify-center text-white/20 text-xs">Sem vídeo</div>
          )}
        </div>

        {/* Modified */}
        <div>
          <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-2">
            <Film className="h-3 w-3 inline mr-1" /> Vídeo Editado
          </p>
          {modified?.file_url ? (
            <>
              <video src={modified.file_url} controls className="w-full rounded-xl bg-black/40 max-h-56 object-contain" />
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/30 font-mono">
                {modified.duration_seconds && <span>{formatDuration(modified.duration_seconds)}</span>}
                {modified.width && modified.height && <span>{modified.width}×{modified.height}</span>}
                {modified.file_size_bytes && <span>{formatBytes(modified.file_size_bytes)}</span>}
                <a href={modified.file_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-white/60">
                  <ExternalLink className="h-3 w-3" /> Abrir
                </a>
              </div>
            </>
          ) : (
            <div className="h-32 rounded-xl bg-white/[0.04] flex items-center justify-center text-white/20 text-xs">Sem vídeo</div>
          )}
        </div>
      </div>

      {/* Text */}
      <div className="mb-4">
        <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-2">
          <FileText className="h-3 w-3 inline mr-1" /> Texto Enviado
        </p>
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
          {text?.content || <span className="text-white/20 italic">Sem texto</span>}
        </div>
      </div>

      {/* Actions */}
      {allPending && (
        <div className="space-y-3 pt-3 border-t border-white/[0.06]">
          <Button
            size="sm"
            onClick={() => onApproveAll(videos.map(v => v.id), text?.id)}
            disabled={isMutating}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar Tudo
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={rejectionReason} onValueChange={setRejectionReason}>
              <SelectTrigger className="w-full max-w-md text-xs h-8 bg-white/[0.04] border-white/[0.08] text-white">
                <SelectValue placeholder="Motivo da rejeição..." />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASONS.map(r => (
                  <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0"
              disabled={isMutating || !rejectionReason}
              onClick={() => { onRejectAll(videos.map(v => v.id), rejectionReason, text?.id); setRejectionReason(""); }}
            >
              <XCircle className="h-3.5 w-3.5" /> Rejeitar Tudo
            </Button>
          </div>
        </div>
      )}

      {overallStatus === "rejected" && (
        <div className="pt-3 border-t border-white/[0.06]">
          <span className="text-[12px] text-red-400 font-mono">
            Rejeitado: {videos[0]?.quality_rejection_reason || videos[0]?.validation_rejection_reason || "—"}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Simple video card ----

function SimpleVideoCard({
  item,
  profileName,
  onApprove,
  onReject,
  isMutating,
}: {
  item: VideoSubmission;
  profileName: string;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  isMutating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const status = getStatus(item);
  const senderName = item.metadata?.sender_name || profileName;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-white/[0.03] transition-colors">
        <div className="h-10 w-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
          <Film className="h-5 w-5 text-white/60" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-white truncate">{item.filename}</span>
            <StatusPill status={status} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] text-white/40">
              <User className="h-3 w-3" /> {senderName}
            </span>
            {item.duration_seconds != null && (
              <span className="text-[11px] text-white/30 font-mono">{formatDuration(item.duration_seconds)}</span>
            )}
            {item.file_size_bytes != null && (
              <span className="text-[11px] text-white/30 font-mono">{formatBytes(item.file_size_bytes)}</span>
            )}
            {item.width && item.height && (
              <span className="text-[11px] text-white/30 font-mono">{item.width}×{item.height}</span>
            )}
            <span className="text-[11px] text-white/30 ml-auto">
              {new Date(item.created_at).toLocaleDateString("pt-BR")}
            </span>
          </div>
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-white/30 shrink-0" />
          : <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06]">
          {item.file_url && (
            <div className="p-5">
              <video src={item.file_url} controls className="w-full max-h-80 rounded-xl bg-black/40 object-contain" />
              <div className="flex items-center gap-2 mt-3">
                <a href={item.file_url} download
                  className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-white/70 transition-colors font-mono">
                  <Download className="h-3 w-3" /> Download
                </a>
                <a href={item.file_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-white/70 transition-colors font-mono">
                  <ExternalLink className="h-3 w-3" /> Abrir
                </a>
              </div>
            </div>
          )}

          {status === "rejected" && (
            <div className="px-5 pb-3">
              <span className="text-[12px] text-red-400 font-mono">
                Rejeitado: {item.quality_rejection_reason || item.validation_rejection_reason || "—"}
              </span>
            </div>
          )}

          {status === "pending" && (
            <div className="p-5 border-t border-white/[0.06] space-y-3">
              <Button size="sm"
                onClick={() => onApprove(item.id)}
                disabled={isMutating}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white">
                <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
              </Button>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={rejectionReason} onValueChange={setRejectionReason}>
                  <SelectTrigger className="w-full max-w-md text-xs h-8 bg-white/[0.04] border-white/[0.08] text-white">
                    <SelectValue placeholder="Motivo da rejeição..." />
                  </SelectTrigger>
                  <SelectContent>
                    {REJECTION_REASONS.map(r => (
                      <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline"
                  className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0"
                  disabled={isMutating || !rejectionReason}
                  onClick={() => { onReject(item.id, rejectionReason); setRejectionReason(""); }}>
                  <XCircle className="h-3.5 w-3.5" /> Rejeitar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main page ----

export default function DataVideoReview() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<OverallStatus>("pending");

  // Fetch campaign info
  const { data: campaign } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      if (!campaignId) return null;
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, campaign_type")
        .eq("id", campaignId)
        .single();
      return data;
    },
  });

  const isPairCampaign = campaign?.campaign_type === "video_prompt_pair";

  // Fetch video submissions
  const { data: videos, isLoading } = useQuery({
    queryKey: ["data-video-review", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_submissions")
        .select("id, campaign_id, user_id, filename, file_url, file_size_bytes, format, duration_seconds, width, height, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, metadata, created_at")
        .eq("campaign_id", campaignId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as VideoSubmission[];
    },
    enabled: !!campaignId,
  });

  // Fetch text submissions (for video_prompt_pair)
  const { data: texts } = useQuery({
    queryKey: ["data-video-review-texts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("text_submissions")
        .select("id, content, quality_status, validation_status, metadata, created_at")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return (data || []) as unknown as TextSubmission[];
    },
    enabled: !!campaignId && isPairCampaign,
  });

  // Fetch profiles
  const userIds = useMemo(
    () => [...new Set((videos || []).map(v => v.user_id).filter(Boolean))],
    [videos]
  );
  const { data: profiles } = useQuery({
    queryKey: ["data-video-review-profiles", userIds],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data } = await supabase.from("profiles").select("id, full_name, email_contact").in("id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });
  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    profiles?.forEach((p: any) => m.set(p.id, p.full_name || p.email_contact || p.id.slice(0, 8)));
    return m;
  }, [profiles]);

  // Group for pair campaigns
  const groupedPairs = useMemo(() => {
    if (!isPairCampaign || !videos) return null;
    const groups = new Map<string, { videos: VideoSubmission[]; text: TextSubmission | null }>();
    for (const v of videos) {
      const gid = v.metadata?.group_id;
      if (!gid) continue;
      if (!groups.has(gid)) groups.set(gid, { videos: [], text: null });
      groups.get(gid)!.videos.push(v);
    }
    // Match texts
    if (texts) {
      for (const t of texts) {
        const gid = (t.metadata as any)?.group_id;
        if (gid && groups.has(gid)) {
          groups.get(gid)!.text = t;
        }
      }
    }
    return Array.from(groups.values())
      .filter(g => {
        const gStatus = g.videos.every(v => getStatus(v) === filter) ? filter : 
          g.videos.some(v => getStatus(v) === "rejected") ? "rejected" : 
          g.videos.every(v => getStatus(v) === "approved") ? "approved" : "pending";
        return gStatus === filter;
      })
      .sort((a, b) => new Date(b.videos[0]?.created_at).getTime() - new Date(a.videos[0]?.created_at).getTime());
  }, [isPairCampaign, videos, texts, filter]);

  // Simple videos (non-paired or videos without group_id)
  const simpleVideos = useMemo(() => {
    if (!videos) return [];
    if (isPairCampaign) {
      // Show videos without group_id as standalone
      return videos.filter(v => !v.metadata?.group_id && getStatus(v) === filter);
    }
    return videos.filter(v => getStatus(v) === filter);
  }, [videos, isPairCampaign, filter]);

  // Counts
  const counts = useMemo(() => {
    if (!videos) return { pending: 0, approved: 0, rejected: 0 };
    let pending = 0, approved = 0, rejected = 0;
    for (const v of videos) {
      const s = getStatus(v);
      if (s === "pending") pending++;
      else if (s === "approved") approved++;
      else rejected++;
    }
    return { pending, approved, rejected };
  }, [videos]);

  // Mutations
  const approveMutation = useMutation({
    mutationFn: async ({ videoIds, textId }: { videoIds: string[]; textId?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const payload = {
        quality_status: "approved",
        validation_status: "approved",
        quality_reviewed_at: now,
        validation_reviewed_at: now,
        quality_reviewed_by: user?.id || null,
        validation_reviewed_by: user?.id || null,
      };
      for (const id of videoIds) {
        const { error } = await (supabase as any).from("video_submissions").update(payload).eq("id", id);
        if (error) throw error;
      }
      if (textId) {
        const { error } = await (supabase as any).from("text_submissions").update(payload).eq("id", textId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-video-review"] });
      queryClient.invalidateQueries({ queryKey: ["data-video-review-texts"] });
      toast.success("Aprovado!");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao aprovar"),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ videoIds, reason, textId }: { videoIds: string[]; reason: string; textId?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const payload = {
        quality_status: "rejected",
        validation_status: "rejected",
        quality_rejection_reason: reason,
        validation_rejection_reason: reason,
        quality_reviewed_at: now,
        validation_reviewed_at: now,
        quality_reviewed_by: user?.id || null,
        validation_reviewed_by: user?.id || null,
      };
      for (const id of videoIds) {
        const { error } = await (supabase as any).from("video_submissions").update(payload).eq("id", id);
        if (error) throw error;
      }
      if (textId) {
        const { error } = await (supabase as any).from("text_submissions").update(payload).eq("id", textId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-video-review"] });
      queryClient.invalidateQueries({ queryKey: ["data-video-review-texts"] });
      toast.success("Rejeitado");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao rejeitar"),
  });

  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  const handleApprove = useCallback((id: string) => approveMutation.mutate({ videoIds: [id] }), [approveMutation]);
  const handleReject = useCallback((id: string, reason: string) => rejectMutation.mutate({ videoIds: [id], reason }), [rejectMutation]);
  const handleApproveAll = useCallback((ids: string[], textId?: string) => approveMutation.mutate({ videoIds: ids, textId }), [approveMutation]);
  const handleRejectAll = useCallback((ids: string[], reason: string, textId?: string) => rejectMutation.mutate({ videoIds: ids, reason, textId }), [rejectMutation]);

  const filterOptions: { value: OverallStatus; label: string; count: number; color: string }[] = [
    { value: "pending", label: "Pendentes", count: counts.pending, color: "text-amber-400" },
    { value: "approved", label: "Aprovados", count: counts.approved, color: "text-emerald-400" },
    { value: "rejected", label: "Rejeitados", count: counts.rejected, color: "text-red-400" },
  ];

  const totalItems = (isPairCampaign ? (groupedPairs?.length || 0) : 0) + simpleVideos.length;

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate("/data/video/campaigns")}
        className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <div className="flex items-center gap-3 mb-8">
        <div className="h-12 w-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
          <Film className="h-6 w-6 text-white/60" />
        </div>
        <div>
          <h1 className="text-[24px] md:text-[28px] font-bold text-white tracking-tight">
            {campaign?.name || "Carregando..."}
          </h1>
          <p className="text-[14px] text-white/40">
            {isPairCampaign ? "Revisão de pares de vídeo + prompt" : "Revisão de vídeos"}
          </p>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {filterOptions.map(opt => (
          <button key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-xl border transition-colors font-medium",
              filter === opt.value
                ? "bg-white/[0.08] border-white/[0.12] text-white"
                : "border-transparent text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
            )}>
            {opt.label}
            {opt.count > 0 && (
              <span className={cn("font-mono text-[11px] px-1.5 rounded-full", filter === opt.value ? opt.color : "text-white/30")}>
                {opt.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-white/30" />
        </div>
      )}

      {!isLoading && totalItems === 0 && (
        <div className="text-center py-20 border border-white/[0.06] rounded-2xl bg-white/[0.02]">
          <Film className="h-12 w-12 text-white/10 mx-auto mb-4" />
          <p className="text-[16px] text-white/30">
            Nenhum vídeo {filter === "pending" ? "pendente" : filter === "approved" ? "aprovado" : "rejeitado"}.
          </p>
        </div>
      )}

      {!isLoading && (
        <div className="space-y-3">
          {/* Grouped pairs */}
          {isPairCampaign && groupedPairs?.map((group, i) => (
            <PairCard
              key={group.videos[0]?.id || i}
              videos={group.videos}
              text={group.text}
              profileName={profileMap.get(group.videos[0]?.user_id) || "Desconhecido"}
              onApproveAll={handleApproveAll}
              onRejectAll={handleRejectAll}
              isMutating={isMutating}
            />
          ))}

          {/* Simple videos */}
          {simpleVideos.map(item => (
            <SimpleVideoCard
              key={item.id}
              item={item}
              profileName={profileMap.get(item.user_id) || "Desconhecido"}
              onApprove={handleApprove}
              onReject={handleReject}
              isMutating={isMutating}
            />
          ))}
        </div>
      )}
    </div>
  );
}
