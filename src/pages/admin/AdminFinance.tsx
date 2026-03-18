import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BrowserProvider, Contract, parseUnits, formatUnits } from "ethers";
import {
  Wallet,
  Send,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Search,
  RefreshCw,
  Copy,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ─── USDT on Polygon ─── */
const USDT_CONTRACT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const POLYGON_CHAIN_ID = "0x89"; // 137
const POLYGON_RPC = "https://polygon-rpc.com";
const POLYGONSCAN = "https://polygonscan.com/tx/";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/* ─── Types ─── */
interface PendingUser {
  user_id: string;
  full_name: string | null;
  wallet_id: string | null;
  country: string | null;
  total_pending: number;
  currency: string;
  earning_ids: string[];
}

/* ─── Helpers ─── */
function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

/* ─── Component ─── */
export default function AdminFinance() {
  const queryClient = useQueryClient();
  const [walletAddr, setWalletAddr] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [payingUserId, setPayingUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  /* ─── Fetch pending earnings grouped by user ─── */
  const { data: pendingUsers = [], isLoading, refetch } = useQuery({
    queryKey: ["admin-finance-pending"],
    queryFn: async () => {
      // Get all credited (unpaid) earnings
      const { data: earnings, error } = await supabase
        .from("earnings_ledger")
        .select("id, user_id, amount, currency, entry_type")
        .eq("status", "credited")
        .order("user_id");

      if (error) throw error;
      if (!earnings?.length) return [];

      // Group by user
      const byUser = new Map<string, { total: number; currency: string; ids: string[] }>();
      for (const e of earnings) {
        const existing = byUser.get(e.user_id) || { total: 0, currency: e.currency, ids: [] };
        existing.total += Number(e.amount);
        existing.ids.push(e.id);
        byUser.set(e.user_id, existing);
      }

      // Fetch profiles
      const userIds = Array.from(byUser.keys());
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, wallet_id, country")
        .in("id", userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const result: PendingUser[] = [];
      for (const [userId, data] of byUser) {
        const profile = profileMap.get(userId);
        result.push({
          user_id: userId,
          full_name: profile?.full_name || null,
          wallet_id: profile?.wallet_id || null,
          country: profile?.country || null,
          total_pending: Math.round(data.total * 10000) / 10000,
          currency: data.currency,
          earning_ids: data.ids,
        });
      }

      return result.sort((a, b) => b.total_pending - a.total_pending);
    },
  });

  /* ─── Connect Wallet ─── */
  const connectWallet = useCallback(async () => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      toast.error("Nenhuma wallet detectada. Instale MetaMask ou Rabby.");
      return;
    }

    setConnecting(true);
    try {
      // Request accounts
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts?.[0]) throw new Error("Nenhuma conta encontrada");

      // Switch to Polygon if needed
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: POLYGON_CHAIN_ID }],
        });
      } catch (switchErr: any) {
        // Chain not added — add it
        if (switchErr.code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: POLYGON_CHAIN_ID,
              chainName: "Polygon Mainnet",
              nativeCurrency: { name: "MATIC", symbol: "POL", decimals: 18 },
              rpcUrls: [POLYGON_RPC],
              blockExplorerUrls: ["https://polygonscan.com"],
            }],
          });
        } else {
          throw switchErr;
        }
      }

      // Small delay to let the wallet settle on the new chain
      await new Promise((r) => setTimeout(r, 500));

      const provider = new BrowserProvider(ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== 137n) {
        throw new Error(`Rede incorreta (chainId ${network.chainId}). Troque para Polygon manualmente e tente novamente.`);
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setWalletAddr(address);

      // Get USDT balance — use hardcoded 6 decimals as fallback
      try {
        const usdt = new Contract(USDT_CONTRACT, ERC20_ABI, provider);
        const balance = await usdt.balanceOf(address);
        setWalletBalance(formatUnits(balance, 6));
      } catch (balErr) {
        console.warn("Erro ao buscar saldo USDT:", balErr);
        setWalletBalance("—");
      }

      toast.success(`Wallet conectada: ${shortAddr(address)}`);
    } catch (err: any) {
      console.error("connectWallet error:", err);
      toast.error(err?.shortMessage || err?.message || "Erro ao conectar wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  /* ─── Pay User ─── */
  const payMutation = useMutation({
    mutationFn: async (user: PendingUser) => {
      const ethereum = (window as any).ethereum;
      if (!ethereum || !walletAddr) throw new Error("Wallet não conectada");
      if (!user.wallet_id) throw new Error("Usuário sem wallet cadastrada");

      // Validate address
      if (!/^0x[a-fA-F0-9]{40}$/.test(user.wallet_id)) {
        throw new Error("Endereço de wallet inválido");
      }

      setPayingUserId(user.user_id);

      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const usdt = new Contract(USDT_CONTRACT, ERC20_ABI, signer);

      const decimals = await usdt.decimals();
      const amount = parseUnits(user.total_pending.toString(), decimals);

      // Send transaction
      const tx = await usdt.transfer(user.wallet_id, amount);
      toast.info(`Tx enviada: ${shortAddr(tx.hash)}. Aguardando confirmação...`);

      // Wait for confirmation
      const receipt = await tx.wait(1);
      if (receipt.status !== 1) throw new Error("Transação falhou on-chain");

      // Mark earnings as paid in DB
      const { error } = await supabase
        .from("earnings_ledger")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          tx_hash: tx.hash,
        } as any)
        .in("id", user.earning_ids);

      if (error) throw error;

      return { txHash: tx.hash, userName: user.full_name };
    },
    onSuccess: ({ txHash, userName }) => {
      toast.success(`Pagamento enviado para ${userName || "usuário"}!`, {
        action: {
          label: "Ver tx",
          onClick: () => window.open(POLYGONSCAN + txHash, "_blank"),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["admin-finance-pending"] });
      // Refresh wallet balance
      connectWallet();
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao processar pagamento");
    },
    onSettled: () => {
      setPayingUserId(null);
    },
  });

  /* ─── Filter ─── */
  const filtered = pendingUsers.filter(u => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      u.full_name?.toLowerCase().includes(q) ||
      u.wallet_id?.toLowerCase().includes(q) ||
      u.user_id.toLowerCase().includes(q)
    );
  });

  const totalPendingUSD = pendingUsers.reduce((s, u) => s + u.total_pending, 0);
  const withWallet = pendingUsers.filter(u => u.wallet_id).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pagamentos via USDT na rede Polygon
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total Pendente"
          value={`$${totalPendingUSD.toFixed(2)}`}
          accent
        />
        <StatCard
          label="Usuários com saldo"
          value={String(pendingUsers.length)}
        />
        <StatCard
          label="Com wallet"
          value={`${withWallet}/${pendingUsers.length}`}
        />
        <StatCard
          label="Saldo USDT (sua wallet)"
          value={walletBalance ? `$${Number(walletBalance).toFixed(2)}` : "—"}
        />
      </div>

      {/* Wallet Connection */}
      <div className={cn(
        "rounded-xl border p-4 flex items-center justify-between",
        walletAddr
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      )}>
        <div className="flex items-center gap-3">
          <Wallet className={cn("h-5 w-5", walletAddr ? "text-emerald-400" : "text-amber-400")} />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {walletAddr ? `Conectada: ${shortAddr(walletAddr)}` : "Wallet não conectada"}
            </p>
            <p className="text-xs text-muted-foreground">
              {walletAddr ? "Polygon • USDT" : "Conecte MetaMask ou Rabby para pagar"}
            </p>
          </div>
        </div>
        <Button
          onClick={connectWallet}
          variant={walletAddr ? "outline" : "default"}
          size="sm"
          disabled={connecting}
        >
          {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
          {walletAddr ? "Reconectar" : "Conectar Wallet"}
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, wallet ou ID..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Users Table */}
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
                const hasWallet = !!user.wallet_id;
                return (
                  <tr key={user.user_id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-foreground">{user.full_name || "Sem nome"}</p>
                        <p className="text-xs text-muted-foreground">{user.country || "—"}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {hasWallet ? (
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted/50 px-2 py-1 rounded font-mono">
                            {shortAddr(user.wallet_id!)}
                          </code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(user.wallet_id!);
                              toast.success("Endereço copiado!");
                            }}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 text-amber-400 text-xs">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Sem wallet
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-foreground">
                        ${user.total_pending.toFixed(2)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">{user.currency}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        onClick={() => payMutation.mutate(user)}
                        disabled={!walletAddr || !hasWallet || isPaying || payMutation.isPending}
                      >
                        {isPaying ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <Send className="h-4 w-4 mr-1" />
                        )}
                        {isPaying ? "Enviando..." : "Pagar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent Payments — last 20 */}
      <RecentPayments />
    </div>
  );
}

/* ─── Recent Payments ─── */
function RecentPayments() {
  const { data: recent = [], isLoading } = useQuery({
    queryKey: ["admin-finance-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("earnings_ledger")
        .select("id, user_id, amount, currency, paid_at, tx_hash, entry_type")
        .eq("status", "paid")
        .not("tx_hash", "is", null)
        .order("paid_at", { ascending: false })
        .limit(20);
      if (error) throw error;

      if (!data?.length) return [];

      const userIds = [...new Set(data.map(d => d.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));

      return data.map(d => ({
        ...d,
        full_name: profileMap.get(d.user_id) || null,
      }));
    },
  });

  if (isLoading || recent.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-foreground">Pagamentos Recentes</h2>
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usuário</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tx Hash</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Data</th>
            </tr>
          </thead>
          <tbody>
            {recent.map(r => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-4 py-3 text-foreground">{r.full_name || "—"}</td>
                <td className="px-4 py-3 text-right font-medium text-foreground">${Number(r.amount).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <a
                    href={POLYGONSCAN + (r as any).tx_hash}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-1 text-primary hover:underline text-xs font-mono"
                  >
                    {shortAddr((r as any).tx_hash || "")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  {r.paid_at ? new Date(r.paid_at).toLocaleDateString("pt-BR") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Stat Card ─── */
function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      <p className={cn("text-xl font-bold", accent ? "text-primary" : "text-foreground")}>{value}</p>
    </div>
  );
}
