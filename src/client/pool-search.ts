import type { MarketRow } from "../shared/types.js";

export function findPools(
  rows: MarketRow[],
  query: string,
  current: string,
  watch: readonly string[],
  watchOnly = false,
): MarketRow[] {
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/[\s/·,]+/).filter(Boolean);
  const watched = new Set(watch);
  const fullIdentity = /^\d+:0x[\da-f]{40}$/.test(normalized);
  const exactPool = (row: MarketRow) =>
    normalized !== "" &&
    (row.snapshot.id.toLowerCase() === normalized ||
      row.snapshot.address.toLowerCase() === normalized);
  return rows
    .filter(({ snapshot: s }) => {
      if (fullIdentity && s.id.toLowerCase() !== normalized) return false;
      if (watchOnly && !watched.has(s.id)) return false;
      const text = [
        s.token0.symbol,
        s.token1.symbol,
        s.token0.address,
        s.token1.address,
        s.chain,
        s.chainId,
        s.address,
        s.id,
        s.poolType > 0 ? "CL" : "Basic",
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort(
      (a, b) =>
        Number(exactPool(b)) - Number(exactPool(a)) ||
        Number(b.snapshot.id === current) - Number(a.snapshot.id === current) ||
        Number(watched.has(b.snapshot.id)) -
          Number(watched.has(a.snapshot.id)) ||
        (b.snapshot.rewards48hUsd ?? -1) - (a.snapshot.rewards48hUsd ?? -1) ||
        a.snapshot.id.localeCompare(b.snapshot.id),
    );
}
