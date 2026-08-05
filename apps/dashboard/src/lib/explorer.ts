/** Explorer base URLs by chain (client-safe, no secrets). */

const EXPLORERS: Record<
  number,
  { name: string; tx: string; address: string }
> = {
  1979: {
    name: "Ritual Explorer",
    tx: "https://explorer.ritualfoundation.org/tx/",
    address: "https://explorer.ritualfoundation.org/address/",
  },
  11155111: {
    name: "Sepolia Etherscan",
    tx: "https://sepolia.etherscan.io/tx/",
    address: "https://sepolia.etherscan.io/address/",
  },
  8453: {
    name: "Basescan",
    tx: "https://basescan.org/tx/",
    address: "https://basescan.org/address/",
  },
  1: {
    name: "Etherscan",
    tx: "https://etherscan.io/tx/",
    address: "https://etherscan.io/address/",
  },
  42161: {
    name: "Arbiscan",
    tx: "https://arbiscan.org/tx/",
    address: "https://arbiscan.org/address/",
  },
  10: {
    name: "Optimistic Etherscan",
    tx: "https://optimistic.etherscan.io/tx/",
    address: "https://optimistic.etherscan.io/address/",
  },
};

export function explorerTxUrl(chainId: number, hash: string): string {
  const base = EXPLORERS[chainId]?.tx;
  if (!base) return `https://explorer.ritualfoundation.org/tx/${hash}`;
  return `${base}${hash}`;
}

export function shortHash(hash: string, n = 6): string {
  if (!hash || hash.length < 12) return hash || "—";
  return `${hash.slice(0, 2 + n)}…${hash.slice(-n)}`;
}

export function chainLabel(chainId: number): string {
  if (chainId === 1979) return "Ritual";
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 8453) return "Base";
  return `chain ${chainId}`;
}
