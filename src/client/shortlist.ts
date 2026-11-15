import {
  compareEarnings,
  type EarningsComparison,
} from "../analysis/earnings.js";
import type { MarketRow } from "../shared/types.js";

export function shortlist(
  rows: MarketRow[],
  estimates: Map<string, EarningsComparison>,
  chain: string,
) {
  const tracked = rows.filter(
    (r) => chain === "all" || r.snapshot.chain === chain,
  );
  const qualified: MarketRow[] = [];
  const baselines: MarketRow[] = [];
  for (const row of tracked) {
    const estimate = estimates.get(row.snapshot.id)!;
    if (estimate.basis === "history" && estimate.stress !== null)
      qualified.push(row);
    if (estimate.basis === "baseline" && estimate.earnings !== null)
      baselines.push(row);
  }
  const hasHistory = qualified.length > 0;
  const candidates = hasHistory ? qualified : baselines;
  const metric = hasHistory ? "stress" : "earnings";
  candidates.sort(
    (a, b) =>
      compareEarnings(
        estimates.get(a.snapshot.id)!,
        estimates.get(b.snapshot.id)!,
        metric,
      ) || a.snapshot.id.localeCompare(b.snapshot.id),
  );
  return {
    tracked: tracked.length,
    qualified: qualified.length,
    baselines: baselines.length,
    visible: candidates.slice(0, hasHistory ? 20 : 10),
  };
}
