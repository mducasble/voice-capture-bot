import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2, XCircle, Hourglass, Download, Film, Image as ImageIcon,
  User, ChevronDown, ExternalLink, Eye, Clock,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { CampaignSelector } from "@/components/CampaignSelector";

// ---- types ----

interface MediaSubmission {
  id: string;
  campaign_id: string;
  user_id: string;
  filename: string;
  file_url: string | null;
  file_size_bytes: number | null;
  format: string | null;
  quality_status: string | null;
  validation_status: string | null;
  quality_rejection_reason: string | null;
  validation_rejection_reason: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
  // video-specific
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  frame_rate?: number | null;
}

type MediaType = "video" | "image";
type StatusFilter = "pending" | "approved" | "rejected";

const REJECTION_REASONS = [
  "Arquivo corrompido ou ilegível",
  "Qualidade abaixo do padrão mínimo",
  "Conteúdo não corresponde à campanha",
  "Formato inválido",
  "Duração fora do esperado",
  "Conteúdo inapropriado",
  "Item de Teste",
];

// ---- helpers ----

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min ${Math.round(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
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

function getOverallStatus(item: MediaSubmission): StatusFilter {
  if (item.quality_status === "approved" && item.validation_status === "approved") return "approved";
  if (item.quality_status === "rejected" || item.validation_status === "rejected") return "rejected";
  return "pending";
}

// ---- Submission Row ----

function SubmissionRow({
  item,
  mediaType,
  profileName,
  onApprove,
  onReject,
  isPending,
}: {
  item: MediaSubmission;
  mediaType: MediaType;
  profileName: string;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const status = getOverallStatus(item);
  const senderName = (item.metadata as any)?.sender_name || profileName;

  return (
    <div className="border border-border/40 rounded-md bg-card/30 overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-secondary/20 transition-colors"
      >
        <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
          {mediaType === "video"
            ? <Film className="h-4 w-4 text-muted-foreground" />
            : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm truncate text-foreground">{item.filename}</span>
            <StatusPill status={status} />
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <User className="h-3 w-3" /> {senderName}
            </span>
            {item.file_size_bytes != null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatBytes(item.file_size_bytes)}
              </span>
            )}
            {item.format && (
              <span className="font-mono text-[9px] px-1.5 py-0.5 bg-secondary/80 text-muted-foreground rounded-sm uppercase">
                {item.format}
              </span>
            )}
            {mediaType === "video" && item.duration_seconds != null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatDuration(item.duration_seconds)}
              </span>
            )}
            {item.width && item.height && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {item.width}×{item.height}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">
              {new Date(item.created_at).toLocaleDateString("pt-BR")}{" "}
              {new Date(item.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/30">
          {/* Preview */}
          {item.file_url && (
            <div className="p-4 bg-secondary/10">
              {mediaType === "video" ? (
                <video
                  src={item.file_url}
                  controls
                  className="max-w-full max-h-64 rounded-md mx-auto"
                  style={{ background: "#000" }}
                />
              ) : (
                <img
                  src={item.file_url}
                  alt={item.filename}
                  className="max-w-full max-h-64 rounded-md mx-auto object-contain cursor-pointer"
                  onClick={() => setPreviewOpen(true)}
                />
              )}
            </div>
          )}

          {/* Actions */}
          <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
            {item.file_url && (
              <>
                <a
                  href={item.file_url}
                  download
                  className="inline-flex items-center gap-1 font-mono text-[10px] px-2.5 py-1.5 rounded-sm bg-secondary/80 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
                <a
                  href={item.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] px-2.5 py-1.5 rounded-sm bg-secondary/80 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> Abrir
                </a>
              </>
            )}
          </div>

          {/* Rejection reason display */}
          {status === "rejected" && (
            <div className="px-4 pb-3">
              <span className="font-mono text-[10px] text-destructive">
                Rejeitado: {item.quality_rejection_reason || item.validation_rejection_reason || "—"}
              </span>
            </div>
          )}

          {/* Approval controls */}
          {status === "pending" && (
            <div className="p-4 border-t border-border/30 bg-secondary/10 space-y-3">
              {mediaType === "video" && item.duration_seconds != null && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <Film className="h-3.5 w-3.5" />
                  Duração: {formatDuration(item.duration_seconds)}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-600"
                  disabled={isPending}
                  onClick={() => onApprove(item.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Aprovar
                </Button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={rejectionReason} onValueChange={setRejectionReason}>
                  <SelectTrigger className="w-full max-w-md text-xs h-8">
                    <SelectValue placeholder="Selecione o motivo da rejeição..." />
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
                  className="gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 shrink-0"
                  disabled={isPending || !rejectionReason}
                  onClick={() => { onReject(item.id, rejectionReason); setRejectionReason(""); }}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Rejeitar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fullscreen image preview */}
      {previewOpen && item.file_url && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setPreviewOpen(false)}
        >
          <img src={item.file_url} alt={item.filename} className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}

// ---- Main component ----

interface MediaReviewTabProps {
  mediaType: MediaType;
}

export function MediaReviewTab({ mediaType }: MediaReviewTabProps) {
  const queryClient = useQueryClient();
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("pending");

  const table = mediaType === "video" ? "video_submissions" : "image_submissions";

  const { data: submissions, isLoading } = useQuery({
    queryKey: [`admin_review_${mediaType}`, selectedCampaign],
    queryFn: async () => {
      const columns = mediaType === "video"
        ? "id, campaign_id, user_id, filename, file_url, file_size_bytes, format, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, created_at, metadata, duration_seconds, width, height, frame_rate"
        : "id, campaign_id, user_id, filename, file_url, file_size_bytes, format, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, created_at, metadata, width, height";

      let query = supabase
        .from(table)
        .select(columns)
        .order("created_at", { ascending: false })
        .limit(500);

      if (selectedCampaign) {
        query = query.eq("campaign_id", selectedCampaign);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as MediaSubmission[];
    },
  });

  // Fetch profiles for user names
  const userIds = useMemo(
    () => [...new Set((submissions || []).map(s => s.user_id).filter(Boolean))],
    [submissions]
  );

  const { data: profiles } = useQuery({
    queryKey: [`admin_review_${mediaType}_profiles`, userIds],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email_contact")
        .in("id", userIds);
      if (error) throw error;
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    profiles?.forEach((p: any) => m.set(p.id, p.full_name || p.email_contact || p.id.slice(0, 8)));
    return m;
  }, [profiles]);

  // Filter
  const filtered = useMemo(() => {
    if (!submissions) return [];
    return submissions.filter(s => getOverallStatus(s) === filter);
  }, [submissions, filter]);

  // Group by user (for video)
  const groupedByUser = useMemo(() => {
    if (mediaType !== "video" || !filtered.length) return null;
    const groups = new Map<string, { items: MediaSubmission[]; totalSeconds: number }>();
    for (const item of filtered) {
      const uid = item.user_id;
      if (!groups.has(uid)) groups.set(uid, { items: [], totalSeconds: 0 });
      const g = groups.get(uid)!;
      g.items.push(item);
      g.totalSeconds += item.duration_seconds ?? 0;
    }
    return Array.from(groups.entries())
      .map(([userId, { items, totalSeconds }]) => ({ userId, items, totalSeconds }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  }, [filtered, mediaType]);

  const counts = useMemo(() => {
    if (!submissions) return { pending: 0, approved: 0, rejected: 0 };
    let pending = 0, approved = 0, rejected = 0;
    for (const s of submissions) {
      const st = getOverallStatus(s);
      if (st === "pending") pending++;
      else if (st === "approved") approved++;
      else rejected++;
    }
    return { pending, approved, rejected };
  }, [submissions]);

  // Mutations
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const { error } = await supabase
        .from(table)
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin_review_${mediaType}`] });
      toast.success("Submissão aprovada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao aprovar"),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const { error } = await supabase
        .from(table)
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin_review_${mediaType}`] });
      toast.success("Submissão rejeitada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao rejeitar"),
  });

  const isMutating = approveMutation.isPending || rejectMutation.isPending;
  const handleApprove = useCallback((id: string) => approveMutation.mutate(id), [approveMutation]);
  const handleReject = useCallback((id: string, reason: string) => rejectMutation.mutate({ id, reason }), [rejectMutation]);

  const filterOptions: { value: StatusFilter; label: string; icon: React.ElementType; color: string }[] = [
    { value: "pending", label: "Pendentes", icon: Hourglass, color: "text-amber-500" },
    { value: "approved", label: "Aprovados", icon: CheckCircle2, color: "text-green-500" },
    { value: "rejected", label: "Rejeitados", icon: XCircle, color: "text-destructive" },
  ];

  return (
    <div className="space-y-4">
      {/* Campaign filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <CampaignSelector
          value={selectedCampaign}
          onChange={setSelectedCampaign}
          className="w-64"
        />
        {selectedCampaign && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedCampaign("")} className="text-xs">
            Todas as campanhas
          </Button>
        )}
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {filterOptions.map(opt => {
          const count = counts[opt.value];
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors font-medium ${
                isActive
                  ? "bg-secondary border-border text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              <opt.icon className={`h-3.5 w-3.5 ${isActive ? opt.color : ""}`} />
              {opt.label}
              {count > 0 && (
                <span className={`font-mono text-[10px] px-1.5 py-0 rounded-full ${
                  isActive ? `${opt.color} bg-background` : "text-muted-foreground bg-secondary/60"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 border border-border bg-card rounded-lg">
          {mediaType === "video"
            ? <Film className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            : <ImageIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />}
          <p className="text-sm text-muted-foreground">
            Nenhuma submissão de {mediaType === "video" ? "vídeo" : "imagem"} {filter === "pending" ? "pendente" : filter === "approved" ? "aprovada" : "rejeitada"}.
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(item => (
            <SubmissionRow
              key={item.id}
              item={item}
              mediaType={mediaType}
              profileName={profileMap.get(item.user_id) || "Desconhecido"}
              onApprove={handleApprove}
              onReject={handleReject}
              isPending={isMutating}
            />
          ))}
        </div>
      )}
    </div>
  );
}
