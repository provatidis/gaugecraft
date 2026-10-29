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
    else if (
      results.some(
        (e) =>
          e?.status !== "proxy" ||
          e.observedReturnProxy === null ||
          !Number.isFinite(e.observedReturnProxy),
      )
    )
      cohorts.incomplete++;
    else paired.push(d);
  }
  const due = evaluations.map((e) => e.dueAt);
  return {
    byId,
    counts,
    cohorts,
    paired,
    firstDue: due.length ? Math.min(...due) : null,
    lastDue: due.length ? Math.max(...due) : null,
  };
}
