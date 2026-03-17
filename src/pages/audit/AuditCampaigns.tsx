import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, FolderOpen, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

interface CampaignRow {
  id: string;
  name: string;
  campaign_status: string | null;
  language_primary: string | null;
  target_hours: number | null;
  accumulated_value: number;
  is_active: boolean | null;
  campaign_type: string | null;
}

export default function AuditCampaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase
      .from("campaigns")
      .select("id, name, campaign_status, language_primary, target_hours, accumulated_value, is_active, campaign_type")
      .order("name")
      .then(({ data }) => { setCampaigns(data || []); setLoading(false); });
  }, []);

  const filtered = campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))] mb-2">Todas as Campanhas</h1>
      <p className="text-[17px] text-[hsl(var(--muted-foreground))] mb-8">Visão geral de todas as campanhas disponíveis</p>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[hsl(var(--muted-foreground))]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar campanha..."
          className="h-14 pl-12 text-[16px] rounded-xl bg-white border-[hsl(var(--border))]"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/audit/audio/validation/${c.id}`)}
              className="w-full text-left p-6 rounded-2xl border border-[hsl(var(--border))] bg-white hover:border-[hsl(var(--primary))]/40 hover:shadow-sm transition-all flex items-center gap-5"
            >
              <div className="h-12 w-12 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
                <FolderOpen className="h-6 w-6 text-[hsl(var(--primary))]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[18px] font-semibold text-[hsl(var(--foreground))] truncate">{c.name}</h3>
                <div className="flex items-center gap-4 mt-1 text-[14px] text-[hsl(var(--muted-foreground))]">
                  <span>{c.language_primary || "—"}</span>
                  <span className={`font-medium px-2 py-0.5 rounded-md ${
                    c.campaign_status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                  }`}>{c.campaign_status || "draft"}</span>
                  <span>{c.campaign_type || "—"}</span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-[hsl(var(--muted-foreground))] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
