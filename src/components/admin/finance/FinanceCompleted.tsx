import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, ExternalLink, Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { POLYGONSCAN, shortAddr } from "@/lib/financeHelpers";

export function FinanceCompleted() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");

  const { data: recent = [], isLoading } = useQuery({
    queryKey: ["admin-finance-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments" as any)
        .select("id, payment_code, tx_hash, user_id, total_amount, currency, paid_at")
        .order("paid_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!data?.length) return [];

      const userIds = [...new Set((data as any[]).map((d: any) => d.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, country")
        .in("id", userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, { name: p.full_name, country: p.country }]));

      return (data as any[]).map((d: any) => ({
        ...d,
        full_name: profileMap.get(d.user_id)?.name || null,
        country: profileMap.get(d.user_id)?.country || null,
      }));
    },
  });

  const { data: expandedEarnings = [] } = useQuery({
    queryKey: ["admin-finance-payment-details", expandedId],
    enabled: !!expandedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("earnings_ledger")
        .select("id, amount, currency, entry_type, description")
        .eq("payment_id", expandedId!)
        .order("amount", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const countries = [...new Set(recent.map((r: any) => r.country).filter(Boolean))] as string[];

  const filtered = recent.filter((r: any) => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!r.full_name?.toLowerCase().includes(q) && !r.payment_code?.toLowerCase().includes(q) && !r.tx_hash?.toLowerCase().includes(q)) return false;
    }
    if (countryFilter !== "all" && r.country !== countryFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, código ou tx hash..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
        </div>
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="País" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os países</SelectItem>
            {countries.sort().map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="font-medium">Nenhuma transação encontrada</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Código</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usuário</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tx Hash</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Data</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => {
                const isExpanded = expandedId === r.id;
                return (
                  <tr key={r.id} className="contents">
                    <tr
                      className="border-b last:border-0 hover:bg-muted/10 cursor-pointer transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          <code className="text-xs font-mono bg-muted/50 px-1.5 py-0.5 rounded">{r.payment_code}</code>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{r.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.country || ""}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-foreground">${Number(r.total_amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <a href={POLYGONSCAN + r.tx_hash} target="_blank" rel="noopener" className="flex items-center gap-1 text-primary hover:underline text-xs font-mono" onClick={e => e.stopPropagation()}>
                          {shortAddr(r.tx_hash || "")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {r.paid_at ? new Date(r.paid_at).toLocaleDateString("pt-BR") : "—"}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b last:border-0">
                        <td colSpan={5} className="px-8 py-3 bg-muted/5">
                          {expandedEarnings.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Carregando detalhes...</p>
                          ) : (
                            <div className="space-y-1">
                              {expandedEarnings.map((e: any) => {
                                const typeLabel = e.entry_type === "task_payment" ? "📋 Tarefa" : "🔗 Referral";
                                const submissionType = e.description?.match(/audio|image|video|text|annotation/i)?.[0] || "";
                                const levelMatch = e.description?.match(/L(\d)/);
                                const levelLabel = levelMatch ? ` (Nível ${levelMatch[1]})` : "";
                                const cleanDesc = submissionType ? submissionType.charAt(0).toUpperCase() + submissionType.slice(1) + levelLabel : "";
                                return (
                                  <div key={e.id} className="flex items-center justify-between text-xs gap-4">
                                    <span className="text-muted-foreground truncate">
                                      {typeLabel}
                                      {cleanDesc && <span className="text-foreground/60 ml-1">— {cleanDesc}</span>}
                                    </span>
                                    <span className="font-medium text-foreground whitespace-nowrap">${Number(e.amount).toFixed(4)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
