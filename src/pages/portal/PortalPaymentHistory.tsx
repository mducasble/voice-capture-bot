import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Loader2, Receipt } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Payment {
  id: string;
  payment_code: string;
  tx_hash: string;
  total_amount: number;
  currency: string;
  paid_at: string;
}

interface LedgerEntry {
  id: string;
  amount: number;
  entry_type: string;
  submission_type: string;
  description: string | null;
  campaign_id: string;
  campaign_name?: string;
}

export default function PortalPaymentHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: payments, isLoading } = useQuery({
    queryKey: ["my-payments", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("payments")
        .select("id, payment_code, tx_hash, total_amount, currency, paid_at")
        .eq("user_id", user.id)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Payment[];
    },
    enabled: !!user?.id,
  });

  const { data: expandedEntries = [] } = useQuery({
    queryKey: ["payment-entries", expandedId],
    queryFn: async () => {
      if (!expandedId) return [];
      const { data, error } = await supabase
        .from("earnings_ledger")
        .select("id, amount, entry_type, submission_type, description, campaign_id")
        .eq("payment_id", expandedId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const entries = (data || []) as LedgerEntry[];
      const campaignIds = [...new Set(entries.map(e => e.campaign_id))];
      if (campaignIds.length > 0) {
        const { data: campaigns } = await supabase
          .from("campaigns")
          .select("id, name")
          .in("id", campaignIds);
        const nameMap = Object.fromEntries((campaigns || []).map(c => [c.id, c.name]));
        entries.forEach(e => { e.campaign_name = nameMap[e.campaign_id] || "—"; });
      }
      return entries;
    },
    enabled: !!expandedId,
  });

  const isTestTx = (p: Payment) => p.total_amount === 1 && p.payment_code?.startsWith("pg-");

  const txUrl = (hash: string) =>
    hash.startsWith("0x")
      ? `https://polygonscan.com/tx/${hash}`
      : hash;

  const fmtDate = (iso: string) => format(new Date(iso), "dd MMM yyyy · HH:mm", { locale: ptBR });

  const entryLabel = (e: LedgerEntry) => {
    const typeMap: Record<string, string> = {
      audio: "Áudio", video: "Vídeo", image: "Imagem", text: "Texto", annotation: "Anotação",
    };
    const sub = typeMap[e.submission_type] || e.submission_type;
    if (e.entry_type === "referral_bonus") {
      const levelMatch = e.description?.match(/L(\d)/);
      const level = levelMatch ? `L${levelMatch[1]}` : "";
      return `Referral ${level} · ${sub}`.trim();
    }
    return `Tarefa · ${sub}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--portal-accent)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => navigate("/earnings")}
        className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
        style={{ color: "var(--portal-text-muted)" }}
      >
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          Extrato de Pagamentos
        </h1>
      </div>

      {(!payments || payments.length === 0) ? (
        <div className="p-8 text-center" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
          <Receipt className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--portal-text-muted)" }} />
          <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
            Nenhuma transação registrada ainda.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map(p => {
            const isTest = isTestTx(p);
            const isExpanded = expandedId === p.id;

            return (
              <div key={p.id} style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  className="w-full flex items-center gap-3 p-4 text-left transition-colors cursor-pointer group"
                  style={{ color: "var(--portal-text)" }}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold transition-colors group-hover:underline" style={{ color: "var(--portal-accent)" }}>
                        US$ {p.total_amount.toFixed(2)}
                      </span>
                      {isTest && (
                        <span className="font-mono text-[10px] px-2 py-0.5 uppercase tracking-widest" style={{ background: "hsl(200 60% 50% / 0.15)", color: "hsl(200 60% 60%)", border: "1px solid hsl(200 60% 50% / 0.3)" }}>
                          Teste
                        </span>
                      )}
                      <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                        {p.payment_code}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] mt-1" style={{ color: "var(--portal-text-muted)" }}>
                      {fmtDate(p.paid_at)}
                    </p>
                  </div>

                  <a
                    href={txUrl(p.tx_hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="flex-shrink-0 font-mono text-[11px] px-3 py-1.5 uppercase tracking-widest transition-colors"
                    style={{ border: "1px solid var(--portal-accent)", color: "var(--portal-accent)" }}
                  >
                    Link da Transação
                  </a>
                </button>

                {isExpanded && !isTest && (
                  <div className="px-4 pb-4 space-y-1" style={{ borderTop: "1px solid var(--portal-border)" }}>
                    <p className="font-mono text-[10px] uppercase tracking-widest py-2" style={{ color: "var(--portal-text-muted)" }}>
                      Itens incluídos neste pagamento
                    </p>
                    {expandedEntries.length === 0 ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--portal-text-muted)" }} />
                      </div>
                    ) : (
                      (() => {
                        const grouped = expandedEntries.reduce<Record<string, LedgerEntry[]>>((acc, e) => {
                          const key = e.campaign_name || "—";
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(e);
                          return acc;
                        }, {});
                        return Object.entries(grouped).map(([campaignName, entries]) => (
                          <div key={campaignName} className="space-y-1">
                            <p className="font-mono text-xs uppercase tracking-widest pt-2 pb-1" style={{ color: "var(--portal-text-muted)" }}>
                              {campaignName}
                            </p>
                            {entries.map(e => (
                              <div key={e.id} className="flex items-center justify-between py-2 px-3" style={{ background: "hsl(0 0% 10%)" }}>
                                <p className="font-mono text-sm" style={{ color: "var(--portal-text)" }}>
                                  {entryLabel(e)}
                                </p>
                                <span className="font-mono text-base font-bold" style={{ color: "var(--portal-text)" }}>
                                  US$ {e.amount.toFixed(4)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ));
                      })()
                    )}
                  </div>
                )}

                {isExpanded && isTest && (
                  <div className="px-4 pb-4" style={{ borderTop: "1px solid var(--portal-border)" }}>
                    <p className="font-mono text-xs py-3" style={{ color: "var(--portal-text-muted)" }}>
                      Transação de verificação de carteira — não vinculada a tarefas.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
