"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type WalletCtx = {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToRitual: () => Promise<void>;
  switchToBase: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
};

const Ctx = createContext<WalletCtx | null>(null);

type Eth = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (e: string, fn: (...args: unknown[]) => void) => void;
};

function getEth(): Eth | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eth }).ethereum;
}

const RITUAL_ID = Number(process.env.NEXT_PUBLIC_RITUAL_CHAIN_ID || 1979);
const RITUAL_RPC =
  process.env.NEXT_PUBLIC_RITUAL_RPC || "https://rpc.ritualfoundation.org";

async function switchChain(chainId: number, add?: Record<string, unknown>) {
  const eth = getEth();
  if (!eth) throw new Error("No wallet");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code === 4902 && add) {
      await eth.request({ method: "wallet_addEthereumChain", params: [add] });
    } else throw e;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    const eth = getEth();
    if (!eth) return;
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    setAddress(accounts[0] || null);
    const hex = (await eth.request({ method: "eth_chainId" })) as string;
    setChainId(Number(hex));
  }, []);

  useEffect(() => {
    void refresh();
    const eth = getEth();
    if (!eth?.on) return;
    const onAcc = () => void refresh();
    const onChain = () => void refresh();
    eth.on("accountsChanged", onAcc);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    const eth = getEth();
    if (!eth) {
      alert("Install MetaMask or another injected wallet");
      return;
    }
    setConnecting(true);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      try {
        await switchChain(RITUAL_ID, {
          chainId: `0x${RITUAL_ID.toString(16)}`,
          chainName: "Ritual Testnet",
          nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
          rpcUrls: [RITUAL_RPC],
          blockExplorerUrls: [
            process.env.NEXT_PUBLIC_EXPLORER_RITUAL ||
              "https://explorer.ritualfoundation.org",
          ],
        });
      } catch {
        /* user may stay on current chain */
      }
      await refresh();
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const switchToRitual = useCallback(async () => {
    await switchChain(RITUAL_ID, {
      chainId: `0x${RITUAL_ID.toString(16)}`,
      chainName: "Ritual Testnet",
      nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
      rpcUrls: [RITUAL_RPC],
      blockExplorerUrls: ["https://explorer.ritualfoundation.org"],
    });
    await refresh();
  }, [refresh]);

  const switchToBase = useCallback(async () => {
    await switchChain(8453);
    await refresh();
  }, [refresh]);

  const switchToSepolia = useCallback(async () => {
    await switchChain(11155111, {
      chainId: "0xaa36a7",
      chainName: "Sepolia",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: [
        process.env.NEXT_PUBLIC_RPC_SEPOLIA ||
          "https://ethereum-sepolia-rpc.publicnode.com",
      ],
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
    });
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      address,
      chainId,
      connecting,
      connect,
      disconnect,
      switchToRitual,
      switchToBase,
      switchToSepolia,
    }),
    [
      address,
      chainId,
      connecting,
      connect,
      disconnect,
      switchToRitual,
      switchToBase,
      switchToSepolia,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside provider");
  return v;
}
