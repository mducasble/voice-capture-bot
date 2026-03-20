import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, Send, TestTube2, Loader2, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { sendUSDT, shortAddr, POLYGONSCAN } from "@/lib/financeHelpers";

interface Props {
  walletAddr: string | null;
  onWalletRefresh: () => void;
}

interface UserRow {
  id: string;
  full_name: string | null;
  wallet_id: string | null;
  wallet_verified: boolean;
  country: string | null;
}

export function FinanceDirectPay({ walletAddr, onWalletRefresh }: Props) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-all-users-finance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, wallet_id, wallet_verified, country")
        .order("full_name");
      if (error) throw error;
      return (data || []) as UserRow[];
    },
  });

  const filtered = searchTerm.length >= 2
    ? users.filter(u => {
        const q = searchTerm.toLowerCase();
        return u.full_name?.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) || u.wallet_id?.toLowerCase().includes(q);
      }).slice(0, 20)
    : [];

  const handleSend = async (isTest: boolean) => {
    if (!selectedUser?.wallet_id) { toast.error("Usuário sem wallet"); return; }
    if (!walletAddr) { toast.error("Conecte sua wallet primeiro"); return; }

    const sendAmount = isTest ? "1" : amount;
    if (!isTest && (!sendAmount || Number(sendAmount) <= 0)) { toast.error("Informe um valor válido"); return; }

    isTest ? setSendingTest(true) : setSending(true);

    try {
      const { hash } = await sendUSDT(selectedUser.wallet_id, Number(sendAmount).toFixed(6));

      const { data: codeResult } = await supabase.rpc("generate_payment_code");
      const paymentCode = codeResult || `pg-${Math.random().toString(36).slice(2, 10)}`;

      await supabase.from("payments").insert({
        payment_code: paymentCode,
        tx_hash: hash,
        user_id: selectedUser.id,
        total_amount: Number(sendAmount),
        currency: "USD",
        paid_at: new Date().toISOString(),
      } as any);

      // Send inbox message for test TX
      if (isTest) {
        const { data: tpl } = await supabase
          .from("inbox_message_templates" as any)
          .select("subject, category, body")
          .eq("template_key", "wallet_test_tx")
          .maybeSingle();
        if (tpl) {
          const adminUser = (await supabase.auth.getUser()).data.user;
          const { data: thread, error: tErr } = await supabase
            .from("inbox_threads" as any)
            .insert({ user_id: selectedUser.id, subject: (tpl as any).subject, category: (tpl as any).category || "payment", created_by: adminUser?.id } as any)
            .select("id")
            .single();
          if (!tErr && thread) {
            const formattedBody = ((tpl as any).body as string).replace(/\[NOME\]/g, selectedUser.full_name || "").replace(/\[WALLET_ADDRESS\]/g, selectedUser.wallet_id || "");
            await supabase.from("inbox_messages" as any).insert({ thread_id: (thread as any).id, sender_id: adminUser?.id, body: formattedBody } as any);
          }
        }
      }

      toast.success(`${isTest ? "Teste TX ($1)" : `$${Number(sendAmount).toFixed(2)}`} enviado para ${selectedUser.full_name}!`, {
        action: { label: "Ver tx", onClick: () => window.open(POLYGONSCAN + hash, "_blank") },
      });

      queryClient.invalidateQueries({ queryKey: ["admin-finance-pending"] });
      queryClient.invalidateQueries({ queryKey: ["admin-finance-recent"] });
      onWalletRefresh();
      if (!isTest) setAmount("");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao enviar");
    } finally {
      isTest ? setSendingTest(false) : setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* User search */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground">Selecionar Usuário</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, wallet ou ID (mín. 2 caracteres)..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); if (selectedUser) setSelectedUser(null); }}
            className="pl-10"
          />
        </div>

        {/* Search results */}
        {!selectedUser && filtered.length > 0 && (
          <div className="rounded-xl border max-h-[300px] overflow-y-auto">
            {filtered.map(u => (
              <button
                key={u.id}
                onClick={() => { setSelectedUser(u); setSearchTerm(u.full_name || u.id); }}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors border-b last:border-0 text-left"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{u.full_name || "Sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{u.country || "—"}</p>
                </div>
                <div className="text-right">
                  {u.wallet_id ? (
                    <code className="text-xs font-mono text-muted-foreground">{shortAddr(u.wallet_id)}</code>
                  ) : (
                    <span className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Sem wallet</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected user card */}
      {selectedUser && (
        <div className="rounded-xl border p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-foreground">{selectedUser.full_name || "Sem nome"}</p>
              <p className="text-sm text-muted-foreground">{selectedUser.country || "—"}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedUser(null); setSearchTerm(""); }}>Trocar</Button>
          </div>

          {selectedUser.wallet_id ? (
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono bg-muted/50 px-3 py-1.5 rounded">{selectedUser.wallet_id}</code>
              <button onClick={() => { navigator.clipboard.writeText(selectedUser.wallet_id!); toast.success("Copiado!"); }} className="text-muted-foreground hover:text-foreground">
                <Copy className="h-4 w-4" />
              </button>
              {selectedUser.wallet_verified && <span className="text-xs text-emerald-400 font-medium">✓ Verificada</span>}
            </div>
          ) : (
            <p className="text-amber-400 text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Sem wallet cadastrada</p>
          )}

          {selectedUser.wallet_id && (
            <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-border">
              {/* Test TX */}
              <Button
                variant="outline"
                onClick={() => handleSend(true)}
                disabled={!walletAddr || sendingTest}
                className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              >
                {sendingTest ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube2 className="h-4 w-4 mr-2" />}
                Teste TX ($1)
              </Button>

              {/* Custom amount */}
              <div className="flex items-end gap-2 flex-1">
                <div className="flex-1 min-w-[120px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Valor (USD)</label>
                  <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <Button onClick={() => handleSend(false)} disabled={!walletAddr || sending || !amount || Number(amount) <= 0}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Enviar ${amount || "0.00"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedUser && !searchTerm && (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Busque um usuário para enviar pagamento direto</p>
          <p className="text-xs mt-1">Teste TX ou qualquer valor em USDT</p>
        </div>
      )}
    </div>
  );
}
