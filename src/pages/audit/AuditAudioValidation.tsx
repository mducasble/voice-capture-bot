import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Search, Loader2, Play, RefreshCw, Sparkles, ChevronRight, Headphones } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/audit/StatusBadge";
import { EmptyState } from "@/components/audit/EmptyState";
import { cn } from "@/lib/utils";

type TabId = "pending" | "approved" | "rejected";

interface RecordingRow {
  id: string;
  filename: string;
  duration_seconds: number | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  quality_status: string | null;
  validation_status: string | null;
  recording_type: string | null;
  metadata: any;
  snr_db: number | null;
  quality_rejection_reason: string | null;
  user_id: string | null;
}

const tabs: { id: TabId; label: string }[] = [
  { id: "pending", label: "Pendentes" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Reprovados" },
];

export default function AuditAudioValidation() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("pending");
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [campaignName, setCampaignName] = useState("");

  useEffect(() => {
    if (!campaignId) return;
    supabase.from("campaigns").select("name").eq("id", campaignId).maybeSingle()
      .then(({ data }) => setCampaignName(data?.name || ""));
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);

    let statusFilter: Record<string, string> = {};
    if (activeTab === "pending") statusFilter = { quality_status: "pending" };
    else if (activeTab === "approved") statusFilter = { quality_status: "approved" };
    else statusFilter = { quality_status: "rejected" };

    let query = supabase
      .from("voice_recordings")
      .select("id, filename, duration_seconds, session_id, created_at, discord_username, quality_status, validation_status, recording_type, metadata, snr_db, quality_rejection_reason, user_id")
      .eq("campaign_id", campaignId)
      .eq("quality_status", statusFilter.quality_status!)
      .order("created_at", { ascending: false })
      .limit(100);

    query.then(({ data }) => {
      setRecordings(data || []);
      setLoading(false);
    });
  }, [campaignId, activeTab]);

  const filtered = recordings.filter((r) => {
    const s = search.toLowerCase();
    if (!s) return true;
    return (
      r.filename?.toLowerCase().includes(s) ||
      r.session_id?.toLowerCase().includes(s) ||
      r.discord_username?.toLowerCase().includes(s)
    );
  });

  const formatDuration = (sec: number | null) => {
    if (!sec) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const getQualityTier = (meta: any) => {
    if (!meta) return null;
    return meta.quality_tier || null;
  };

  const tierColors: Record<string, string> = {
    PQ: "bg-blue-100 text-blue-700",
    HQ: "bg-emerald-100 text-emerald-700",
    MQ: "bg-amber-100 text-amber-700",
    LQ: "bg-red-100 text-red-700",
  };

  // Count totals (simple client-side for now)
  const counts: Record<TabId, number> = {
    pending: activeTab === "pending" ? filtered.length : 0,
    approved: activeTab === "approved" ? filtered.length : 0,
    rejected: activeTab === "rejected" ? filtered.length : 0,
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-[14px] text-[hsl(var(--muted-foreground))] mb-2">
          <span>Áudio</span>
          <ChevronRight className="h-4 w-4" />
          <span>Validação</span>
          <ChevronRight className="h-4 w-4" />
          <span className="text-[hsl(var(--foreground))] font-medium">{campaignName}</span>
        </div>
        <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))]">
          Sessões pendentes de validação
        </h1>
        <p className="text-[17px] text-[hsl(var(--muted-foreground))] mt-1">
          Ouça o áudio principal e revise as métricas antes de decidir
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-6 py-3 rounded-xl text-[16px] font-semibold transition-all",
              activeTab === tab.id
                ? "bg-[hsl(var(--primary))] text-white shadow-sm"
                : "bg-white text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[hsl(var(--muted-foreground))]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código da sessão, nome da pessoa..."
          className="h-14 pl-12 text-[16px] rounded-xl bg-white border-[hsl(var(--border))]"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nenhuma sessão encontrada"
          description={`Não há sessões ${activeTab === "pending" ? "pendentes" : activeTab === "approved" ? "aprovadas" : "reprovadas"} para esta campanha.`}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((rec) => {
            const tier = getQualityTier(rec.metadata);
            const snr = rec.snr_db ?? rec.metadata?.snr_db;
            const sigmos = rec.metadata?.sigmos_ovrl;
            const hasEnhanced = !!rec.metadata?.enhanced_file_url;

            return (
              <button
                key={rec.id}
                onClick={() => navigate(`/audit/audio/validation/${campaignId}/${rec.id}`)}
                className="w-full text-left p-5 rounded-2xl border border-[hsl(var(--border))] bg-white hover:border-[hsl(var(--primary))]/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-5">
                  <div className="h-12 w-12 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
                    <Headphones className="h-6 w-6 text-[hsl(var(--primary))]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-[17px] font-semibold text-[hsl(var(--foreground))] truncate">
                        {rec.discord_username || rec.filename}
                      </span>
                      <StatusBadge status={rec.quality_status || "pending"} />
                      {tier && (
                        <span className={cn("text-[12px] font-bold px-2 py-0.5 rounded-md", tierColors[tier] || "bg-gray-100 text-gray-600")}>
                          {tier}
                        </span>
                      )}
                      {hasEnhanced && (
                        <span className="text-[12px] font-medium px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          Enhanced
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-[14px] text-[hsl(var(--muted-foreground))]">
                      {rec.session_id && <span className="font-mono">{rec.session_id.slice(0, 8)}...</span>}
                      <span>{formatDuration(rec.duration_seconds)}</span>
                      {snr != null && <span>SNR: {Number(snr).toFixed(1)} dB</span>}
                      {sigmos != null && <span>SigMOS: {Number(sigmos).toFixed(2)}</span>}
                      <span>{new Date(rec.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>
                    {rec.quality_rejection_reason && (
                      <p className="text-[13px] text-red-600 mt-1 truncate">
                        Motivo: {rec.quality_rejection_reason}
                      </p>
                    )}
                  </div>

                  <ChevronRight className="h-5 w-5 text-[hsl(var(--muted-foreground))] shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
