import { BrowserProvider, Contract, parseUnits, formatUnits } from "ethers";

export const USDT_CONTRACT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
export const POLYGON_CHAIN_ID = "0x89";
export const POLYGON_RPC = "https://rpc.ankr.com/polygon";
export const POLYGONSCAN = "https://polygonscan.com/tx/";

export const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export interface PendingUser {
  user_id: string;
  full_name: string | null;
  wallet_id: string | null;
  wallet_verified: boolean;
  country: string | null;
  total_pending: number;
  currency: string;
  earning_ids: string[];
  campaigns?: string[];
}

export interface WalletState {
  address: string | null;
  balance: string | null;
  connecting: boolean;
}

export function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export async function connectPolygonWallet(): Promise<{ address: string; balance: string }> {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error("Nenhuma wallet detectada. Instale MetaMask ou Rabby.");

  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("Nenhuma conta encontrada");

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYGON_CHAIN_ID }],
    });
  } catch (switchErr: any) {
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

  await new Promise((r) => setTimeout(r, 500));

  const provider = new BrowserProvider(ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== 137n) {
    throw new Error(`Rede incorreta (chainId ${network.chainId}). Troque para Polygon.`);
  }

  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  let balance = "—";
  try {
    const usdt = new Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const bal = await usdt.balanceOf(address);
    balance = formatUnits(bal, 6);
  } catch {}

  return { address, balance };
}

export async function sendUSDT(to: string, amountStr: string): Promise<{ hash: string }> {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error("Wallet não conectada");
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("Endereço de wallet inválido");

  const provider = new BrowserProvider(ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== 137n) throw new Error("Rede incorreta. Troque para Polygon.");

  const signer = await provider.getSigner();
  const usdt = new Contract(USDT_CONTRACT, ERC20_ABI, signer);
  const amount = parseUnits(amountStr, 6);

  const tx = await usdt.transfer(to, amount);
  const receipt = await tx.wait(1);
  if (receipt.status !== 1) throw new Error("Transação falhou on-chain");

  return { hash: tx.hash };
}
