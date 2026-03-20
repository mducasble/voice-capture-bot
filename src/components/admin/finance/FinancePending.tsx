import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Send, CheckCircle2, AlertTriangle, Loader2, Search, Copy, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { shortAddr, sendUSDT, POLYGONSCAN, type PendingUser } from "@/lib/financeHelpers";

interface Props {
  walletAddr: string | null;
  onWalletRefresh: () => void;
}

export function FinancePending({ walletAddr, onWalletRefresh }: Props) {
  const queryClient = useQueryClient();
  const [payingUserId, setPayingUserId] = useState<string | null>(null);
  const [testingUserId, setTestingUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");

  const { data: pendingUsers = [], isLoading } = useQuery({
    queryKey: ["admin-finance-pending"],
    queryFn: async () => {
      const { data: earnings, error } = await supabase
        .from("earnings_ledger")
        .select("id, user_id, amount, currency, entry_type, campaign_id")
        .eq("status", "credited")
        .order("user_id");
      if (error) throw error;
      if (!earnings?.length) return [];

      const byUser = new Map<string, { total: number; currency: string; ids: string[]; campaigns: Set<string> }>();
      for (const e of earnings) {
        const existing = byUser.get(e.user_id) || { total: 0, currency: e.currency, ids: [], campaigns: new Set<string>() };
        existing.total += Number(e.amount);
        existing.ids.push(e.id);
        existing.campaigns.add(e.campaign_id);
        byUser.set(e.user_id, existing);
      }

      const userIds = Array.from(byUser.keys());
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, wallet_id, wallet_verified, country")
        .in("id", userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const result: PendingUser[] = [];
      for (const [userId, data] of byUser) {
        const profile = profileMap.get(userId);
        result.push({
          user_id: userId,
          full_name: profile?.full_name || null,
          wallet_id: profile?.wallet_id || null,
          wallet_verified: profile?.wallet_verified ?? false,
          country: profile?.country || null,
          total_pending: Math.round(data.total * 10000) / 10000,
          currency: data.currency,
          earning_ids: data.ids,
          campaigns: Array.from(data.campaigns),
        });
      }
      return result.sort((a, b) => b.total_pending - a.total_pending);
    },
  });

  // Fetch campaign names for filter
  const campaignIds = [...new Set(pendingUsers.flatMap(u => u.campaigns || []))];
  const { data: campaignNames = {} } = useQuery({
    queryKey: ["finance-campaign-names", campaignIds.join(",")],
    enabled: campaignIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("campaigns").select("id, name").in("id", campaignIds);
      const map: Record<string, string> = {};
      (data || []).forEach(c => { map[c.id] = c.name; });
      return map;
    },
  });

  const countries = [...new Set(pendingUsers.map(u => u.country).filter(Boolean))] as string[];

  const filtered = pendingUsers.filter(u => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!u.full_name?.toLowerCase().includes(q) && !u.wallet_id?.toLowerCase().includes(q) && !u.user_id.toLowerCase().includes(q)) return false;
    }
    if (countryFilter !== "all" && u.country !== countryFilter) return false;
    if (campaignFilter !== "all" && !u.campaigns?.includes(campaignFilter)) return false;
    return true;
  });

  /* ─── Pay mutation ─── */
  const payMutation = useMutation({
    mutationFn: async (user: PendingUser) => {
      if (!walletAddr) throw new Error("Wallet não conectada");
      if (!user.wallet_id) throw new Error("Usuário sem wallet cadastrada");
      setPayingUserId(user.user_id);

      const { hash } = await sendUSDT(user.wallet_id, user.total_pending.toFixed(6));
      toast.info(`Tx enviada: ${shortAddr(hash)}. Aguardando confirmação...`);

      const { data: codeResult } = await supabase.rpc("generate_payment_code");
      const paymentCode = codeResult || `pg-${Math.random().toString(36).slice(2, 10)}`;

      const { data: payment, error: paymentErr } = await supabase
        .from("payments")
        .insert({
          payment_code: paymentCode,
          tx_hash: hash,
          user_id: user.user_id,
          total_amount: user.total_pending,
          currency: user.currency,
          paid_at: new Date().toISOString(),
        } as any)
        .select("id")
        .single();
      if (paymentErr) throw paymentErr;

      const { error } = await supabase
        .from("earnings_ledger")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          tx_hash: hash,
          payment_id: payment.id,
        } as any)
        .in("id", user.earning_ids);
      if (error) throw error;

      return { txHash: hash, userName: user.full_name, paymentCode };
    },
    onSuccess: ({ txHash, userName, paymentCode }) => {
      toast.success(`${paymentCode} — Pagamento enviado para ${userName || "usuário"}!`, {
        action: { label: "Ver tx", onClick: () => window.open(POLYGONSCAN + txHash, "_blank") },
      });
      queryClient.invalidateQueries({ queryKey: ["admin-finance-pending"] });
      queryClient.invalidateQueries({ queryKey: ["admin-finance-recent"] });
      onWalletRefresh();
    },
    onError: (err: any) => toast.error(err?.message || "Erro ao processar pagamento"),
    onSettled: () => setPayingUserId(null),
  });

  /* ─── Test TX mutation ─── */
  const testTxMutation = useMutation({
    mutationFn: async (user: PendingUser) => {
      if (!walletAddr) throw new Error("Wallet não conectada");
      if (!user.wallet_id) throw new Error("Usuário sem wallet cadastrada");
      setTestingUserId(user.user_id);

      const { hash } = await sendUSDT(user.wallet_id, "1");
      toast.info(`Teste TX enviada: ${shortAddr(hash)}. Aguardando...`);

      const { data: codeResult } = await supabase.rpc("generate_payment_code");
      const paymentCode = codeResult || `pg-${Math.random().toString(36).slice(2, 10)}`;

      await supabase.from("payments").insert({
        payment_code: paymentCode,
        tx_hash: hash,
        user_id: user.user_id,
        total_amount: 1,
        currency: user.currency || "USD",
        paid_at: new Date().toISOString(),
      } as any);

      // Send inbox message
      const { data: tpl } = await supabase
        .from("inbox_message_templates" as any)
        .select("subject, category, body")
        .eq("template_key", "wallet_test_tx")
        .maybeSingle();

      if (tpl) {
        const adminUser = (await supabase.auth.getUser()).data.user;
        const { data: thread, error: tErr } = await supabase
          .from("inbox_threads" as any)
          .insert({ user_id: user.user_id, subject: (tpl as any).subject, category: (tpl as any).category || "payment", created_by: adminUser?.id } as any)
          .select("id")
          .single();
        if (!tErr && thread) {
          const formattedBody = ((tpl as any).body as string).replace(/\[NOME\]/g, user.full_name || "").replace(/\[WALLET_ADDRESS\]/g, user.wallet_id || "");
          await supabase.from("inbox_messages" as any).insert({ thread_id: (thread as any).id, sender_id: adminUser?.id, body: formattedBody } as any);
        }
      }

      return { txHash: hash, userName: user.full_name };
    },
    onSuccess: ({ txHash, userName }) => {
      toast.success(`Teste TX ($1) enviado para ${userName || "usuário"}!`, {
        action: { label: "Ver tx", onClick: () => window.open(POLYGONSCAN + txHash, "_blank") },
      });
      queryClient.invalidateQueries({ queryKey: ["admin-finance-pending"] });
      onWalletRefresh();
    },
    onError: (err: any) => toast.error(err?.message || "Erro no teste TX"),
    onSettled: () => setTestingUserId(null),
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, wallet ou ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
        </div>
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="País" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os países</SelectItem>
            {countries.sort().map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Campanha" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as campanhas</SelectItem>
            {Object.entries(campaignNames).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-500/50" />
          <p className="font-medium">Nenhum pagamento pendente</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usuário</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Wallet</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => {
                const isPaying = payingUserId === user.user_id;
                const isTesting = testingUserId === user.user_id;
                const hasWallet = !!user.wallet_id;
                return (
                  <tr key={user.user_id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{user.full_name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground">{user.country || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      {hasWallet ? (
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted/50 px-2 py-1 rounded font-mono">{shortAddr(user.wallet_id!)}</code>
                          <button onClick={() => { navigator.clipboard.writeText(user.wallet_id!); toast.success("Copiado!"); }} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 text-amber-400 text-xs"><AlertTriangle className="h-3.5 w-3.5" /> Sem wallet</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-foreground">${user.total_pending.toFixed(2)}</span>
                      <span className="text-xs text-muted-foreground ml-1">{user.currency}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {hasWallet && !user.wallet_verified && (
                          <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Enviar $1 de teste para ${user.full_name}?`)) testTxMutation.mutate(user); }} disabled={!walletAddr || isTesting || testTxMutation.isPending} className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
                            {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <TestTube2 className="h-4 w-4 mr-1" />}
                            Teste
                          </Button>
                        )}
                        <Button size="sm" onClick={() => payMutation.mutate(user)} disabled={!walletAddr || !hasWallet || isPaying || payMutation.isPending}>
                          {isPaying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                          {isPaying ? "Enviando..." : "Pagar"}
                        </Button>
                      </div>
                    </td>
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
