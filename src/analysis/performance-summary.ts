import type { Evaluation } from "../shared/types.js";

export const BENCHMARK_NAMES: Record<string, string> = {
  persistence: "Persistence stress ranking",
  highestApr: "Highest current Stake APR",
  highestRewards: "Highest estimated pool rewards",
  highestFees: "Highest eligible fee estimate",
};
export interface DecisionGroup {
  at: number;
  choices: Record<string, string | null>;
}
function hasReturn(
  e: Evaluation | undefined,
): e is Evaluation & { observedReturnProxy: number } {
  return (
    e?.status === "proxy" &&
    e.observedReturnProxy !== null &&
    Number.isFinite(e.observedReturnProxy)
  );
}

function missingReturn(
  id: string | null | undefined,
  e: Evaluation | undefined,
) {
  if (!id) return "No pool selection was saved.";
  if (!e) return "The selected forecast is outside this evaluation sample.";
  if (e.status === "proxy") return "A complete earnings amount is unavailable.";
  return e.reason;
}

function compareRule(
  key: string,
  decisions: DecisionGroup[],
  byId: Map<string, Evaluation>,
) {
  const exclusions = new Map<string, number>();
  let matched = 0,
    counterWindows = 0,
    samePick = 0,
    shortlistTotal = 0,
    benchmarkTotal = 0;
  for (const { choices } of decisions) {
    const chosen = byId.get(choices.persistence ?? "");
    const rival = byId.get(choices[key] ?? "");
    if (hasReturn(chosen) && hasReturn(rival)) {
      matched++;
      if (chosen.feeWindowEvidence || rival.feeWindowEvidence) counterWindows++;
      if (chosen.poolId === rival.poolId) samePick++;
      shortlistTotal += chosen.observedReturnProxy;
      benchmarkTotal += rival.observedReturnProxy;
      continue;
    }
    if (!hasReturn(chosen)) {
      const why = `Shortlist · ${missingReturn(choices.persistence, chosen)}`;
      exclusions.set(why, (exclusions.get(why) ?? 0) + 1);
    }
    if (!hasReturn(rival)) {
      const why = `Benchmark · ${missingReturn(choices[key], rival)}`;
      exclusions.set(why, (exclusions.get(why) ?? 0) + 1);
    }
  }
  return {
    key,
    matched,
    counterWindows,
    samePick,
    shortlistMean: matched ? shortlistTotal / matched : null,
    benchmarkMean: matched ? benchmarkTotal / matched : null,
    meanDifference: matched
      ? (shortlistTotal - benchmarkTotal) / matched
      : null,
    exclusions: [...exclusions].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  };
}
export function performanceSummary(
  evaluations: Evaluation[],
  decisions: DecisionGroup[],
) {
  const byId = new Map(evaluations.map((e) => [e.forecastId, e]));
  const counts = { proxy: 0, pending: 0, insufficient: 0 };
  for (const e of evaluations) counts[e.status]++;
  const cohorts = {
    missingSelection: 0,
    pending: 0,
    missingEvaluation: 0,
    incomplete: 0,
  };
  const paired: DecisionGroup[] = [];
  for (const d of decisions) {
    const ids = Object.keys(BENCHMARK_NAMES).map((key) => d.choices[key]);
    if (ids.some((id) => !id)) {
      cohorts.missingSelection++;
      continue;
    }
    const results = ids.map((id) => byId.get(id!));
    if (results.some((e) => e?.status === "pending")) cohorts.pending++;
    else if (results.some((e) => !e)) cohorts.missingEvaluation++;
    else if (results.some((e) => !hasReturn(e))) cohorts.incomplete++;
    else paired.push(d);
  }
  const selected = decisions.flatMap(({ choices }) => {
    const outcome = byId.get(choices.persistence ?? "");
    return hasReturn(outcome) &&
      outcome.estimatedReturn !== null &&
      Number.isFinite(outcome.estimatedReturn)
      ? [
          {
            forecast: outcome.estimatedReturn,
            observed: outcome.observedReturnProxy,
          },
        ]
      : [];
  });
  const shortlistAccuracy = {
    matched: selected.length,
    forecast: selected.length
      ? selected.reduce((sum, x) => sum + x.forecast, 0) / selected.length
      : null,
    observed: selected.length
      ? selected.reduce((sum, x) => sum + x.observed, 0) / selected.length
      : null,
  };
  const due = evaluations.map((e) => e.dueAt);
  return {
    byId,
    counts,
    cohorts,
    paired,
    shortlistAccuracy,
    comparisons: Object.keys(BENCHMARK_NAMES)
      .filter((key) => key !== "persistence")
      .map((key) => compareRule(key, decisions, byId)),
    firstDue: due.length ? Math.min(...due) : null,
    lastDue: due.length ? Math.max(...due) : null,
  };
}
