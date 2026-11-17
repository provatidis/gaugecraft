import { compareEarnings, type EarningsComparison } from "./earnings.js";
import type { MarketRow } from "../shared/types.js";

export function shortlist(
  rows: MarketRow[],
  estimates: Map<string, EarningsComparison>,
  chain: string,
  useReturningCompetition = false,
) {
  const tracked = rows.filter(
    (r) => chain === "all" || r.snapshot.chain === chain,
  );
  const qualified: MarketRow[] = [];
  const baselines: MarketRow[] = [];
  const stressMetric = useReturningCompetition ? "returningStress" : "stress";
  for (const row of tracked) {
    const estimate = estimates.get(row.snapshot.id)!;
    const stress = estimate[stressMetric];
    if (estimate.basis === "history" && stress != null && stress > 0)
      qualified.push(row);
    if (
      !useReturningCompetition &&
      estimate.basis === "baseline" &&
      estimate.earnings !== null &&
      estimate.earnings > 0
    )
      baselines.push(row);
  }
  const hasHistory = qualified.length > 0;
  const candidates = hasHistory ? qualified : baselines;
  const metric = hasHistory ? stressMetric : "earnings";
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
