import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Search, FolderOpen, ChevronRight, Loader2, ArrowLeft } from "lucide-react";

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  campaign_status: string | null;
  language_primary: string | null;
  target_hours: number | null;
  accumulated_value: number;
}

export default function DataCampaignSelect() {
  const { mediaType } = useParams<{ mediaType: string }>();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase
      .from("campaigns")
      .select("id, name, description, campaign_status, language_primary, target_hours, accumulated_value")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => { setCampaigns(data || []); setLoading(false); });
  }, []);

  const filtered = campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const mediaLabel = mediaType === "audio" ? "Áudio" : mediaType === "video" ? "Vídeo" : "Foto";

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate("/data")} className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <h1 className="text-[28px] md:text-[32px] font-bold text-white tracking-tight mb-2">
        Campanhas de {mediaLabel}
      </h1>
      <p className="text-[16px] text-white/40 mb-8">Selecione uma campanha para começar a validar</p>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar campanha..."
          className="w-full h-14 pl-12 pr-4 text-[16px] rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-white/25 backdrop-blur-xl focus:outline-none focus:border-[hsl(var(--primary))]/40 focus:ring-1 focus:ring-[hsl(var(--primary))]/20 transition-all"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <FolderOpen className="h-16 w-16 text-white/10 mx-auto mb-4" />
          <p className="text-[18px] text-white/30">Nenhuma campanha encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const progress = c.target_hours && c.target_hours > 0
              ? Math.min(100, (c.accumulated_value / c.target_hours) * 100) : 0;

            return (
              <button
                key={c.id}
                onClick={() => navigate(`/data/${mediaType}/task/${c.id}`)}
                className="group w-full text-left p-5 md:p-6 rounded-2xl data-glass-card hover:bg-white/[0.06] hover:border-[hsl(var(--primary))]/30 transition-all flex items-center gap-5"
              >
                <div className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
                  <FolderOpen className="h-6 w-6 text-white/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[17px] font-semibold text-white truncate">{c.name}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[13px] text-white/40">{c.language_primary || "—"}</span>
                    <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${
                      c.campaign_status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.06] text-white/40"
                    }`}>
                      {c.campaign_status || "draft"}
                    </span>
                    {c.target_hours && c.target_hours > 0 && (
                      <span className="text-[12px] text-white/30">
                        {progress.toFixed(0)}% concluído
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
