/** CoinGecko simple price map (ids → USD). */

const CACHE_MS = 45_000;
let cache: { at: number; map: Map<string, number> } | null = null;

export async function getPrices(ids: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  const map = new Map<string, number>();
  if (uniq.length === 0) return map;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${uniq.join(",")}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const json = (await res.json()) as Record<string, { usd?: number }>;
    for (const id of uniq) {
      const u = json[id]?.usd;
      if (typeof u === "number") map.set(id, u);
    }
    cache = { at: Date.now(), map };
  } catch (e) {
    console.warn("[prices]", e);
    if (cache) return cache.map;
  }
  return map;
}
