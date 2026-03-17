import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Search, FolderOpen, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  campaign_status: string | null;
  language_primary: string | null;
  target_hours: number | null;
  accumulated_value: number;
  is_active: boolean | null;
}

export default function AuditCampaignSelect() {
  const { process } = useParams<{ process: string }>();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase
      .from("campaigns")
      .select("id, name, description, campaign_status, language_primary, target_hours, accumulated_value, is_active")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setCampaigns(data || []);
        setLoading(false);
      });
  }, []);

  const filtered = campaigns.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const processLabel = process === "validation" ? "Validação" : "Transcrição";

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))] mb-2">
        Selecione a Campanha
      </h1>
      <p className="text-[17px] text-[hsl(var(--muted-foreground))] mb-8">
        Áudio → {processLabel} — Escolha a campanha para iniciar a auditoria
      </p>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[hsl(var(--muted-foreground))]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar campanha por nome..."
          className="h-14 pl-12 text-[16px] rounded-xl bg-white border-[hsl(var(--border))]"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <FolderOpen className="h-16 w-16 text-[hsl(var(--muted-foreground))]/30 mx-auto mb-4" />
          <p className="text-[18px] text-[hsl(var(--muted-foreground))]">Nenhuma campanha encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const progress = c.target_hours && c.target_hours > 0
              ? Math.min(100, (c.accumulated_value / c.target_hours) * 100)
              : 0;

            return (
              <button
                key={c.id}
                onClick={() => navigate(`/audit/audio/${process}/${c.id}`)}
                className="w-full text-left p-6 rounded-2xl border border-[hsl(var(--border))] bg-white hover:border-[hsl(var(--primary))]/40 hover:shadow-sm transition-all flex items-center gap-5"
              >
                <div className="h-12 w-12 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
                  <FolderOpen className="h-6 w-6 text-[hsl(var(--primary))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[18px] font-semibold text-[hsl(var(--foreground))] truncate">{c.name}</h3>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-[14px] text-[hsl(var(--muted-foreground))]">
                      {c.language_primary || "—"}
                    </span>
                    <span className={`text-[13px] font-medium px-2 py-0.5 rounded-md ${
                      c.campaign_status === "active"
                        ? "bg-[hsl(142_71%_45%)]/10 text-[hsl(142_71%_45%)]"
                        : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                    }`}>
                      {c.campaign_status || "draft"}
                    </span>
                    {c.target_hours && c.target_hours > 0 && (
                      <span className="text-[13px] text-[hsl(var(--muted-foreground))]">
                        {c.accumulated_value.toFixed(1)} / {c.target_hours}h ({progress.toFixed(0)}%)
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-[hsl(var(--muted-foreground))] shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
