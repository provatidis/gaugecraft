import test from "node:test";
import assert from "node:assert/strict";
import {
  BENCHMARK_NAMES,
  performanceSummary,
} from "../src/analysis/performance-summary.js";
import type { Evaluation } from "../src/shared/types.js";

function evaluation(
  id: string,
  status: Evaluation["status"],
  value: number | null = 2,
): Evaluation {
  return {
    forecastId: id,
    poolId: "8453:pool",
    dueAt: 100,
    status,
    reason: "fixture",
    projectedRevenue: 10,
    observedRevenueProxy: null,
    revenueError: null,
    revenuePctError: null,
    projectedAllocation: null,
    observedAllocation: null,
    allocationError: null,
    allocationPctError: null,
    estimatedReturn: null,
    observedReturnProxy: value,
    returnError: null,
    returnPctError: null,
    observedFeeReturnPer1000: null,
  };
}
const choices = (id: string | null) =>
  Object.fromEntries(Object.keys(BENCHMARK_NAMES).map((key) => [key, id]));
test("benchmark diagnostics account for every group and compare only complete matched outcomes", () => {
  const evaluations = [
    evaluation("good", "proxy"),
    evaluation("waiting", "pending"),
    evaluation("gap", "insufficient"),
    evaluation("missing-value", "proxy", null),
  ];
  const decisions = [
    null,
    "waiting",
    "absent",
    "gap",
    "good",
    "missing-value",
  ].map((id, at) => ({ at, choices: choices(id) }));
  const s = performanceSummary(evaluations, decisions);
  assert.deepEqual(s.counts, { proxy: 2, pending: 1, insufficient: 1 });
  assert.deepEqual(s.cohorts, {
    missingSelection: 1,
    pending: 1,
    missingEvaluation: 1,
    incomplete: 2,
  });
  assert.equal(s.paired.length, 1);
  assert.equal(s.paired[0].choices.persistence, "good");
  assert.equal(
    s.paired.length + Object.values(s.cohorts).reduce((a, b) => a + b, 0),
    decisions.length,
  );
});
test("empty samples have no implied date range or completed benchmarks", () => {
  const s = performanceSummary([], []);
  assert.equal(s.firstDue, null);
  assert.equal(s.lastDue, null);
  assert.equal(s.paired.length, 0);
});
