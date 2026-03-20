import { useState } from "react";
import { Wallet, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { shortAddr, connectPolygonWallet, type WalletState } from "@/lib/financeHelpers";

interface WalletBarProps {
  wallet: WalletState;
  onConnect: (address: string, balance: string) => void;
  onDisconnect: () => void;
}

export function WalletBar({ wallet, onConnect, onDisconnect }: WalletBarProps) {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { address, balance } = await connectPolygonWallet();
      onConnect(address, balance);
      toast.success(`Wallet conectada: ${shortAddr(address)}`);
    } catch (err: any) {
      toast.error(err?.shortMessage || err?.message || "Erro ao conectar wallet");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const ethereum = (window as any).ethereum;
      if (ethereum?.request) {
        await ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      }
    } catch {}
    onDisconnect();
    toast.info("Wallet desconectada");
  };

  return (
    <div className={cn(
      "rounded-xl border p-4 flex items-center justify-between",
      wallet.address
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-amber-500/30 bg-amber-500/5"
    )}>
      <div className="flex items-center gap-3">
        <Wallet className={cn("h-5 w-5", wallet.address ? "text-emerald-400" : "text-amber-400")} />
        <div>
          <p className="text-sm font-semibold text-foreground">
            {wallet.address ? `Conectada: ${shortAddr(wallet.address)}` : "Wallet não conectada"}
          </p>
          <p className="text-xs text-muted-foreground">
            {wallet.address ? "Polygon • USDT" : "Conecte MetaMask ou Rabby para pagar"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {wallet.address && (
          <Button onClick={handleDisconnect} variant="ghost" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
            Desconectar
          </Button>
        )}
        <Button onClick={handleConnect} variant={wallet.address ? "outline" : "default"} size="sm" disabled={connecting}>
          {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
          {wallet.address ? "Reconectar" : "Conectar Wallet"}
        </Button>
      </div>
    </div>
  );
}
