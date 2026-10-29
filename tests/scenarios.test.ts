import test from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../server/demo.js";
import { forecast } from "../src/analysis/forecast.js";
import { allocationEarnings } from "../src/analysis/earnings.js";
import { simulateAllocation } from "../src/analysis/scenarios.js";
import { HOUR, SCENARIOS, type SimulationInput } from "../src/analysis/math.js";
import type { MarketRow } from "../src/shared/types.js";

const t = 1792656000;
function fixture(): MarketRow {
  const snapshot = {
    ...demoSnapshot(t - 60),
    mode: "live" as const,
    retrievedAt: t,
    allocation: 1000,
    eligibleFees48hUsd: 100,
    programs: [
      {
        id: "test",
        token: { address: "0x1", symbol: "TEST", decimals: 18 },
        rateRaw: (10n ** 36n).toString(),
        start: t - HOUR,
        end: t + HOUR,
        priceUsd: 1,
      },
    ],
  };
  const f = forecast(snapshot, [snapshot]);
  f.projectedAllocation = 2000;
  f.basis = "history";
  return { snapshot, forecast: f, aprChange: null, allocationChange: null };
}
const input: SimulationInput = {
  power: 300,
  existingPower: 200,
  stakeValueUsd: null,
  remainingDays: null,
  activationDelayHours: 0,
};
const near = (actual: number | null, expected: number) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-8,
    `${actual} != ${expected}`,
  );

test("opening a Markets estimate or stress preserves growth, existing power and the forecast cutoff", () => {
  const row = fixture();
  const before = JSON.stringify(row);
  const e = allocationEarnings(row, input.power, input.existingPower, t);
  assert.equal(row.forecast.madeAt, t);
  assert.equal(row.forecast.projectedIncentives, 3600);
  near(
    simulateAllocation(row, input, "forecast", undefined, t).earnings,
    e.earnings!,
  );
  near(
    simulateAllocation(row, input, "stress", undefined, t).earnings,
    e.stress!,
  );
  near(
    simulateAllocation(row, input, "current", undefined, t).earnings,
    (300 / 1100) * 3700,
  );
  assert.equal(
    JSON.stringify(row),
    before,
    "a personal scenario must not mutate frozen forecasts",
  );
});
test("timing respects incentive expiry and capital changes APR only", () => {
  const row = fixture();
  const delayed = simulateAllocation(
    row,
    { ...input, activationDelayHours: 2 },
    "forecast",
    undefined,
    t,
  );
  near(delayed.earnings, ((300 / 1900) * 100 * 46) / 48);
  const plain = simulateAllocation(row, input, "forecast", undefined, t);
  const withCapital = simulateAllocation(
    row,
    { ...input, stakeValueUsd: 1000 },
    "forecast",
    undefined,
    t,
  );
  assert.equal(withCapital.earnings, plain.earnings);
  near(withCapital.apr, (plain.earnings! / 1000) * 182.5 * 100);
  assert.ok(
    simulateAllocation(
      row,
      { ...input, remainingDays: 1 },
      "forecast",
      undefined,
      t,
    ).earnings! < plain.earnings!,
  );
});
test("extra competition and revenue shocks apply to the selected starting case", () => {
  const row = fixture();
  const stress = simulateAllocation(row, input, "stress", undefined, t);
  near(
    simulateAllocation(row, input, "stress", SCENARIOS[4], t).earnings,
    stress.earnings! / 2,
  );
  near(
    simulateAllocation(row, input, "stress", SCENARIOS[2], t).earnings,
    (300 / (800 * 2 * 1.5 * 1.5 + 300)) * (50 + 3600),
  );
});
test("expired observations, partial windows and invalid inputs cannot produce a comparable simulation", () => {
  const row = fixture();
  assert.equal(
    simulateAllocation(row, input, "forecast", undefined, t + 76 * 60).earnings,
    null,
  );
  for (const change of [
    { power: 0 },
    { existingPower: 1001 },
    { activationDelayHours: 49 },
    { remainingDays: 0 },
    { stakeValueUsd: -1 },
  ])
    assert.equal(
      simulateAllocation(row, { ...input, ...change }, "forecast", undefined, t)
        .earnings,
      null,
    );
  row.snapshot.windowStart = row.snapshot.windowEnd - 12 * HOUR;
  assert.equal(
    simulateAllocation(row, input, "current", undefined, t).earnings,
    null,
  );
  row.snapshot.windowStart = row.snapshot.windowEnd - 48 * HOUR;
  row.snapshot.programs = null;
  assert.equal(
    simulateAllocation(row, input, "forecast", undefined, t).earnings,
    null,
  );
});
