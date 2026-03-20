import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { connectPolygonWallet, type WalletState } from "@/lib/financeHelpers";
import { WalletBar } from "@/components/admin/finance/WalletBar";
import { FinancePending } from "@/components/admin/finance/FinancePending";
import { FinanceCompleted } from "@/components/admin/finance/FinanceCompleted";
import { FinanceDirectPay } from "@/components/admin/finance/FinanceDirectPay";
import { toast } from "sonner";

export default function AdminFinance() {
  const [wallet, setWallet] = useState<WalletState>({ address: null, balance: null, connecting: false });

  const handleConnect = (address: string, balance: string) => {
    setWallet({ address, balance, connecting: false });
  };

  const handleDisconnect = () => {
    setWallet({ address: null, balance: null, connecting: false });
  };

  const refreshWallet = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const { address, balance } = await connectPolygonWallet();
      setWallet(prev => ({ ...prev, address, balance }));
    } catch {}
  }, [wallet.address]);

  /* ─── Summary stats ─── */
  const { data: stats, refetch } = useQuery({
    queryKey: ["admin-finance-summary"],
    queryFn: async () => {
      const { data: earnings, error } = await supabase
        .from("earnings_ledger")
        .select("user_id, amount")
        .eq("status", "credited");
      if (error) throw error;

      const userSet = new Set<string>();
      let total = 0;
      for (const e of earnings || []) {
        total += Number(e.amount);
        userSet.add(e.user_id);
      }
      return { totalPending: total, usersWithBalance: userSet.size };
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">Pagamentos</h1>
          <p className="text-sm text-muted-foreground mt-1">USDT via rede Polygon</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total a Pagar" value={`$${(stats?.totalPending || 0).toFixed(2)}`} accent />
        <StatCard label="Usuários com Saldo" value={String(stats?.usersWithBalance || 0)} />
        <StatCard label="Saldo na Wallet" value={wallet.balance ? `$${Number(wallet.balance).toFixed(2)}` : "—"} />
      </div>

      {/* Wallet */}
      <WalletBar wallet={wallet} onConnect={handleConnect} onDisconnect={handleDisconnect} />

      {/* Tabs */}
      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pending">Pendentes</TabsTrigger>
          <TabsTrigger value="completed">Realizadas</TabsTrigger>
          <TabsTrigger value="direct">Pagamento Direto</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <FinancePending walletAddr={wallet.address} onWalletRefresh={refreshWallet} />
        </TabsContent>

        <TabsContent value="completed">
          <FinanceCompleted />
        </TabsContent>

        <TabsContent value="direct">
          <FinanceDirectPay walletAddr={wallet.address} onWalletRefresh={refreshWallet} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      <p className={cn("text-xl font-bold", accent ? "text-primary" : "text-foreground")}>{value}</p>
    </div>
  );
}
