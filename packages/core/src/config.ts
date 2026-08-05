/** Chains, tokens, app limits — Ritual-first; Base mainnet only for live DeFi; Sepolia for agent testnets. */

export interface ChainConfig {
  chainId: number;
  name: string;
  testnet: boolean;
  family: "ritual" | "base" | "ethereum";
  rpcEnvVar: string;
  defaultRpc: string;
  nativeSymbol: string;
  coingeckoNativeId: string;
  explorerTx: string;
  explorerAddress: string;
  /** true = real-fund DeFi (Base mainnet only) */
  allowLiveDefi: boolean;
  uniswapV3Router?: string;
  weth?: string;
}

export const RITUAL_CHAIN_ID = 1979;
export const BASE_MAINNET_ID = 8453;
export const SEPOLIA_ID = 11155111;

export const CHAINS: Record<number, ChainConfig> = {
  [RITUAL_CHAIN_ID]: {
    chainId: RITUAL_CHAIN_ID,
    name: "Ritual Testnet",
    testnet: true,
    family: "ritual",
    rpcEnvVar: "RPC_URL_RITUAL",
    defaultRpc: "https://rpc.ritualfoundation.org",
    nativeSymbol: "RITUAL",
    coingeckoNativeId: "ethereum",
    explorerTx: "https://explorer.ritualfoundation.org/tx/",
    explorerAddress: "https://explorer.ritualfoundation.org/address/",
    allowLiveDefi: false,
  },
  [SEPOLIA_ID]: {
    chainId: SEPOLIA_ID,
    name: "Sepolia",
    testnet: true,
    family: "ethereum",
    rpcEnvVar: "RPC_URL_SEPOLIA",
    defaultRpc: "https://ethereum-sepolia-rpc.publicnode.com",
    nativeSymbol: "ETH",
    coingeckoNativeId: "ethereum",
    explorerTx: "https://sepolia.etherscan.io/tx/",
    explorerAddress: "https://sepolia.etherscan.io/address/",
    allowLiveDefi: false,
    // Uniswap v3 SwapRouter02 on Sepolia
    uniswapV3Router: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
    weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  },
  [BASE_MAINNET_ID]: {
    chainId: BASE_MAINNET_ID,
    name: "Base",
    testnet: false,
    family: "base",
    rpcEnvVar: "RPC_URL_BASE",
    defaultRpc: "https://base-rpc.publicnode.com",
    nativeSymbol: "ETH",
    coingeckoNativeId: "ethereum",
    explorerTx: "https://basescan.org/tx/",
    explorerAddress: "https://basescan.org/address/",
    allowLiveDefi: true,
    weth: "0x4200000000000000000000000000000000000006",
  },
};

export interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
  coingeckoId: string;
}

export const TOKENS: Record<number, TokenConfig[]> = {
  [RITUAL_CHAIN_ID]: [
    {
      symbol: "RITUAL",
      address: "native",
      decimals: 18,
      coingeckoId: "ethereum",
    },
  ],
  [SEPOLIA_ID]: [
    { symbol: "ETH", address: "native", decimals: 18, coingeckoId: "ethereum" },
    {
      symbol: "WETH",
      address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      decimals: 18,
      coingeckoId: "weth",
    },
    {
      symbol: "USDC",
      address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      decimals: 6,
      coingeckoId: "usd-coin",
    },
  ],
  [BASE_MAINNET_ID]: [
    { symbol: "ETH", address: "native", decimals: 18, coingeckoId: "ethereum" },
    {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006",
      decimals: 18,
      coingeckoId: "weth",
    },
    {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      coingeckoId: "usd-coin",
    },
  ],
};

export const APP_LIMITS = {
  maxTxUsd: Number(process.env.MAX_TX_USD || 25),
  maxTxPerDay: Number(process.env.MAX_TX_PER_DAY || 20),
};

export const WORKER = {
  loopIntervalMs: 30_000,
  startupCooldownMs: 15_000,
  maxConsecutiveFailures: 5,
};

export const RITUAL_SYSTEM = {
  wallet: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948",
  scheduler: "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B",
  http: "0x0000000000000000000000000000000000000801",
  llm: "0x0000000000000000000000000000000000000802",
} as const;

export function getChain(chainId: number): ChainConfig {
  const c = CHAINS[chainId];
  if (!c) {
    throw new Error(
      `Unsupported chain ${chainId}. Use Ritual ${RITUAL_CHAIN_ID}, Sepolia ${SEPOLIA_ID}, or Base ${BASE_MAINNET_ID}.`
    );
  }
  return c;
}

export function getRpcUrl(chainId: number): string {
  const c = getChain(chainId);
  return process.env[c.rpcEnvVar] || c.defaultRpc;
}

export function getToken(
  chainId: number,
  symbol: string
): TokenConfig | undefined {
  return TOKENS[chainId]?.find(
    (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
  );
}

export function listChainsPublic() {
  return Object.values(CHAINS).map((c) => ({
    chainId: c.chainId,
    name: c.name,
    testnet: c.testnet,
    family: c.family,
    nativeSymbol: c.nativeSymbol,
    explorerTx: c.explorerTx,
    allowLiveDefi: c.allowLiveDefi,
  }));
}

export function listTokensPublic() {
  const out: Record<string, { symbol: string; coingeckoId: string }[]> = {};
  for (const [id, list] of Object.entries(TOKENS)) {
    out[id] = list.map((t) => ({
      symbol: t.symbol,
      coingeckoId: t.coingeckoId,
    }));
  }
  return out;
}
