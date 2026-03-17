import { useState } from "react";
import { Search, Headphones, Loader2, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/audit/StatusBadge";
import { EmptyState } from "@/components/audit/EmptyState";
import { useNavigate } from "react-router-dom";

interface Result {
  id: string;
  filename: string;
  session_id: string | null;
  discord_username: string | null;
  quality_status: string | null;
  duration_seconds: number | null;
  campaign_id: string | null;
  created_at: string;
}

export default function AuditSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);

    // Search by session_id or discord_username
    const { data } = await supabase
      .from("voice_recordings")
      .select("id, filename, session_id, discord_username, quality_status, duration_seconds, campaign_id, created_at")
      .or(`session_id.ilike.%${query}%,discord_username.ilike.%${query}%,filename.ilike.%${query}%`)
      .order("created_at", { ascending: false })
      .limit(50);

    setResults(data || []);
    setLoading(false);
  };

  const formatDuration = (sec: number | null) => {
    if (!sec) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))] mb-2">Busca de Sessões</h1>
      <p className="text-[17px] text-[hsl(var(--muted-foreground))] mb-8">
        Busque por código da sessão, nome da pessoa ou arquivo
      </p>

      <div className="flex gap-3 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Código da sessão, nome da pessoa ou arquivo..."
            className="h-14 pl-12 text-[16px] rounded-xl bg-white border-[hsl(var(--border))]"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="h-14 px-8 text-[16px] rounded-xl bg-[hsl(var(--primary))]"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Buscar"}
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <EmptyState title="Nenhum resultado encontrado" description="Tente buscar com outros termos." />
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => r.campaign_id && navigate(`/audit/audio/validation/${r.campaign_id}/${r.id}`)}
              className="w-full text-left p-5 rounded-2xl border border-[hsl(var(--border))] bg-white hover:border-[hsl(var(--primary))]/40 hover:shadow-sm transition-all flex items-center gap-4"
            >
              <div className="h-11 w-11 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
                <Headphones className="h-5 w-5 text-[hsl(var(--primary))]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[16px] font-semibold text-[hsl(var(--foreground))] truncate">{r.discord_username || r.filename}</p>
                <div className="flex items-center gap-3 text-[14px] text-[hsl(var(--muted-foreground))]">
                  {r.session_id && <span className="font-mono">{r.session_id.slice(0, 8)}</span>}
                  <span>{formatDuration(r.duration_seconds)}</span>
                  <span>{new Date(r.created_at).toLocaleDateString("pt-BR")}</span>
                </div>
              </div>
              <StatusBadge status={r.quality_status || "pending"} />
              <ChevronRight className="h-5 w-5 text-[hsl(var(--muted-foreground))] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
