import test from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../server/demo.js";
import { forecast } from "../src/analysis/forecast.js";
import { HOUR, type SimulationInput } from "../src/analysis/math.js";
import { simulateSplit } from "../src/analysis/split.js";
import type { MarketRow } from "../src/shared/types.js";

const time = 1792656000;
const budget: SimulationInput = {
  power: 600,
  existingPower: 100,
  activationDelayHours: 0,
  remainingDays: null,
  stakeValueUsd: null,
};
function pool(index: number): MarketRow {
  const snapshot = {
    ...demoSnapshot(time, index),
    mode: "live" as const,
    allocation: 1000,
    programs: [],
    eligibleFees48hUsd: 200,
  };
  return {
    snapshot,
    forecast: forecast(snapshot, [snapshot]),
    aprChange: null,
    allocationChange: null,
  };
}

test("compares both single-pool placements with a budget-conserving, independently diluted split", () => {
  const first = pool(0);
  const second = pool(1);
  second.forecast.projectedAllocation = 2000;
  const estimate = simulateSplit(
    first,
    second,
    25,
    budget,
    300,
    "forecast",
    time,
  );
  assert.equal(estimate.error, null);
  assert.equal(estimate.firstPower + estimate.secondPower, budget.power);
  assert.equal(estimate.firstOnly.earnings, (600 / 1500) * 200);
  assert.equal(estimate.secondOnly.earnings, (600 / 2000) * 200);
  assert.equal(estimate.firstLeg.earnings, (150 / 1050) * 200);
  assert.equal(estimate.secondLeg.earnings, (450 / 1850) * 200);
  assert.equal(
    estimate.total,
    estimate.firstLeg.earnings! + estimate.secondLeg.earnings!,
  );
  assert.notEqual(
    estimate.total,
    estimate.firstOnly.earnings! * 0.25 + estimate.secondOnly.earnings! * 0.75,
  );
});

test("the split inherits fee stress, competing allocation shocks, delay and decay", () => {
  const first = pool(0),
    second = pool(1);
  const stress = simulateSplit(first, second, 60, budget, 200, "stress", time);
  assert.equal(stress.error, null);
  assert.equal(
    stress.total,
    (360 / (900 * 1.5 + 360)) * 100 + (240 / (800 * 1.5 + 240)) * 100,
  );
  const delayed = simulateSplit(
    first,
    second,
    60,
    { ...budget, activationDelayHours: 24 },
    200,
    "stress",
    time,
  );
  assert.equal(delayed.error, null);
  assert.ok(Math.abs(delayed.total! - stress.total! / 2) < 1e-10);
  const expired = simulateSplit(
    first,
    second,
    60,
    { ...budget, remainingDays: 0.5, activationDelayHours: 13 },
    200,
    "stress",
    time,
  );
  assert.equal(expired.error, null);
  assert.equal(expired.total, 0);
});

test("an incomplete or stale second pool never becomes a zero-dollar split leg", () => {
  for (const block of [
    (row: MarketRow) => {
      row.snapshot.retrievedAt = time - 2 * HOUR;
    },
    (row: MarketRow) => {
      row.snapshot.active = false;
    },
    (row: MarketRow) => {
      row.snapshot.windowStart = time - HOUR;
    },
    (row: MarketRow) => {
      row.forecast.projectedFees = null;
    },
  ]) {
    const first = pool(0),
      second = pool(1);
    block(second);
    const result = simulateSplit(first, second, 50, budget, 0, "current", time);
    assert.equal(result.error, null);
    assert.ok(result.firstOnly.earnings! > 0);
    assert.equal(result.total, null);
    assert.ok(result.secondLeg.error);
  }
});

test("unmatched windows, duplicate pools and incompatible networks or modes cannot be summed", () => {
  const first = pool(0);
  assert.ok(simulateSplit(first, first, 50, budget, 0, "forecast", time).error);
  for (const change of [
    (r: MarketRow) => {
      r.forecast.madeAt--;
    },
    (r: MarketRow) => {
      r.forecast.dueAt--;
    },
    (r: MarketRow) => {
      r.snapshot.chainId++;
    },
    (r: MarketRow) => {
      r.snapshot.mode = "demo";
    },
  ]) {
    const second = pool(1);
    change(second);
    assert.ok(
      simulateSplit(first, second, 50, budget, 0, "forecast", time).error,
    );
  }
});
