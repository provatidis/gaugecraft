import test from "node:test";
import assert from "node:assert/strict";
import { shortlist } from "../src/client/shortlist.js";
import { allocationEarnings } from "../src/analysis/earnings.js";
import { demoSnapshot } from "../server/demo.js";
import { forecast } from "../src/analysis/forecast.js";
import type { MarketRow } from "../src/shared/types.js";

const at = 1792656000;
function candidate(
  id: number,
  chain: string,
  fees: number,
  incentives: number,
  basis: "history" | "insufficient",
): MarketRow {
  const snapshot = { ...demoSnapshot(at, id), chain, allocation: 1000 };
  return {
    snapshot,
    forecast: {
      ...forecast(snapshot, [snapshot]),
      basis,
      projectedAllocation: 1000,
      projectedFees: fees,
      projectedIncentives: incentives,
    },
    aprChange: null,
    allocationChange: null,
  };
}

test("the shortlist screens by network, isolates baselines and ranks stress at the selected size", () => {
  const feePool = candidate(0, "A", 100, 0, "history");
  const incentivePool = candidate(1, "A", 0, 67, "history");
  const baseline = candidate(2, "B", 1000, 0, "insufficient");
  const incomplete = candidate(3, "A", 40, 0, "history");
  incomplete.forecast.projectedFees = null;
  const rows = [feePool, baseline, incomplete, incentivePool];
  const estimates = new Map(
    rows.map((row) => [row.snapshot.id, allocationEarnings(row, 2000, 0, at)]),
  );
  const all = shortlist(rows, estimates, "all");
  assert.equal(all.tracked, 4);
  assert.equal(all.qualified, 2);
  assert.equal(all.baselines, 1);
  assert.deepEqual(all.visible, [incentivePool, feePool]);
  assert.deepEqual(shortlist(rows, estimates, "B").visible, [baseline]);
  assert.deepEqual(shortlist(rows, estimates, "Missing").visible, []);
});
