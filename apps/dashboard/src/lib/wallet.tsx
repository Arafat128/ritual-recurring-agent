"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api";

type AuthState = {
  authenticated: boolean;
  authorized: boolean;
  sessionAddress: string | null;
  agentEvm: string | null;
  signingIn: boolean;
  authError: string | null;
};

type WalletCtx = {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchToRitual: () => Promise<void>;
  switchToBase: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
  /** SIWE session — must be authorized to see rules/history */
  auth: AuthState;
  refreshAuth: () => Promise<void>;
  signIn: () => Promise<boolean>;
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

const emptyAuth: AuthState = {
  authenticated: false,
  authorized: false,
  sessionAddress: null,
  agentEvm: null,
  signingIn: false,
  authError: null,
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [auth, setAuth] = useState<AuthState>(emptyAuth);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await api("/api/auth/session");
      const data = await res.json();
      setAuth((a) => ({
        ...a,
        authenticated: Boolean(data.authenticated),
        authorized: Boolean(data.authorized),
        sessionAddress: data.address || null,
        agentEvm: data.agentEvm || null,
        authError: null,
      }));
    } catch {
      setAuth((a) => ({
        ...a,
        authenticated: false,
        authorized: false,
        sessionAddress: null,
      }));
    }
  }, []);

  const signIn = useCallback(async (): Promise<boolean> => {
    const eth = getEth();
    const accounts = eth
      ? ((await eth.request({ method: "eth_accounts" })) as string[])
      : [];
    const addr = accounts[0];
    if (!eth || !addr) {
      setAuth((a) => ({
        ...a,
        authError: "Connect a wallet first",
        signingIn: false,
      }));
      return false;
    }

    setAuth((a) => ({ ...a, signingIn: true, authError: null }));
    try {
      const nonceRes = await api("/api/auth/nonce");
      const { nonce } = await nonceRes.json();
      if (!nonce) throw new Error("No nonce");

      const msgRes = await api("/api/auth/verify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: addr,
          nonce,
          chainId: chainId ?? RITUAL_ID,
        }),
      });
      const { message } = await msgRes.json();
      if (!message) throw new Error("No login message");

      const signature = (await eth.request({
        method: "personal_sign",
        params: [message, addr],
      })) as string;

      const verifyRes = await api("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: addr,
          signature,
          message,
          nonce,
          chainId: chainId ?? RITUAL_ID,
        }),
      });
      const data = await verifyRes.json();

      if (!verifyRes.ok || !data.authorized) {
        setAuth({
          authenticated: false,
          authorized: false,
          sessionAddress: null,
          agentEvm: data.agentEvm || null,
          signingIn: false,
          authError:
            data.error ||
            "This wallet is not the agent. Connect the agent EOA to view history and rules.",
        });
        return false;
      }

      setAuth({
        authenticated: true,
        authorized: true,
        sessionAddress: data.address,
        agentEvm: data.agentEvm || null,
        signingIn: false,
        authError: null,
      });
      return true;
    } catch (e) {
      setAuth((a) => ({
        ...a,
        signingIn: false,
        authenticated: false,
        authorized: false,
        authError: e instanceof Error ? e.message : "Sign-in failed",
      }));
      return false;
    }
  }, [chainId]);

  const refresh = useCallback(async () => {
    const eth = getEth();
    if (!eth) return;
    const accounts = (await eth.request({
      method: "eth_accounts",
    })) as string[];
    setAddress(accounts[0] || null);
    const hex = (await eth.request({ method: "eth_chainId" })) as string;
    setChainId(Number(hex));
  }, []);

  useEffect(() => {
    void refresh();
    void refreshAuth();
    const eth = getEth();
    if (!eth?.on) return;
    const onAcc = () => {
      void (async () => {
        await refresh();
        // Account switched — drop session and require re-sign
        await api("/api/auth/logout", { method: "POST" });
        setAuth(emptyAuth);
        await refreshAuth();
      })();
    };
    const onChain = () => void refresh();
    eth.on("accountsChanged", onAcc);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [refresh, refreshAuth]);

  // Auto sign-in when wallet is connected but session missing/mismatched
  useEffect(() => {
    if (!address) return;
    if (auth.signingIn) return;
    if (
      auth.authorized &&
      auth.sessionAddress &&
      auth.sessionAddress.toLowerCase() === address.toLowerCase()
    ) {
      return;
    }
    // Connected but not authorized for this address — attempt SIWE once
    void signIn();
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

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
      await signIn();
    } finally {
      setConnecting(false);
    }
  }, [refresh, signIn]);

  const disconnect = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAddress(null);
    setAuth(emptyAuth);
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
      auth,
      refreshAuth,
      signIn,
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
      auth,
      refreshAuth,
      signIn,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside provider");
  return v;
}
