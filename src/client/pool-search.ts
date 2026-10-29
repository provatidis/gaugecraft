import type { MarketRow } from "../shared/types.js";

export function matchesPool({ snapshot: s }: MarketRow, query: string) {
  const normalized = query.trim().toLowerCase();
  if (/^\d+:0x[\da-f]{40}$/.test(normalized))
    return s.id.toLowerCase() === normalized;
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
  return normalized
    .split(/[\s/·,]+/)
    .filter(Boolean)
    .every((term) => text.includes(term));
}

export function findPools(
  rows: MarketRow[],
  query: string,
  current: string,
  watch: readonly string[],
  watchOnly = false,
): MarketRow[] {
  const normalized = query.trim().toLowerCase();
  const watched = new Set(watch);
  const exactPool = (row: MarketRow) =>
    normalized !== "" &&
    (row.snapshot.id.toLowerCase() === normalized ||
      row.snapshot.address.toLowerCase() === normalized);
  return rows
    .filter(
      (row) =>
        (!watchOnly || watched.has(row.snapshot.id)) && matchesPool(row, query),
    )
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
