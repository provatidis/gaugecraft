import test from "node:test";
import type { Snapshot } from "../src/shared/types.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  persistenceCoverage,
  PERSISTENCE_REQUIREMENTS,
} from "../src/analysis/coverage.js";
import { forecast } from "../src/analysis/forecast.js";
import { demoSnapshot } from "../server/demo.js";
import { markets } from "../server/markets.js";
import { Store } from "../server/store.js";
const t = 1792656000;
const sample = (at: number): Snapshot => ({
  ...demoSnapshot(at),
  allocation: 1000,
  eligibleFees48hUsd: 100,
  programs: [],
  incentives48hUsd: 0,
  rewards48hUsd: 100,
});
const rows = Array.from({ length: 97 }, (_, i) =>
  sample(t - 172800 + i * 1800),
);

test("readiness diagnostics preserve the exact existing forecast outputs", () => {
  const s = sample(t);
  const parityRows = Array.from({ length: 97 }, (_, i) => ({
    ...s,
    observedAt: t - 172800 + i * 1800,
    retrievedAt: t - 172800 + i * 1800,
  }));
  const cases: [Snapshot, Snapshot[]][] = [
    [s, parityRows],
    [s, parityRows.slice(80)],
    [s, parityRows.filter((_, i) => i < 20 || i > 25)],
    [{ ...s, windowStart: t - 3600 }, parityRows],
    [
      s,
      parityRows.map((r, i) => ({
        ...r,
        eligibleFees48hUsd: i % 4 === 0 ? null : 100,
      })),
    ],
    [s, [...parityRows, { ...s, observedAt: t + 1800, retrievedAt: t + 1800 }]],
  ];
  const hash = createHash("sha256")
    .update(JSON.stringify(cases.map(([s, h]) => forecast(s, h))))
    .digest("hex");
  assert.equal(
    hash,
    "5bbc049a7c651418cb85abe91aa0b8a3c5f5abe75d1305fd490b9a870c9c7458",
  );
  for (const [s, h] of cases)
    assert.equal(
      persistenceCoverage(s, h).ready,
      forecast(s, h).basis === "history",
    );
});
test("coverage counts exclude other pools, fixtures, future blocks and late retrievals", () => {
  const original = persistenceCoverage(sample(t), rows);
  const extras = [
    { ...sample(t - 60), id: "8453:other" },
    { ...sample(t - 60), mode: "live" as const },
    { ...sample(t - 60), retrievedAt: t + 1 },
    sample(t + 1800),
    sample(t - 172801),
  ];
  assert.deepEqual(
    persistenceCoverage(sample(t), [...rows, ...extras]),
    original,
  );
});
test("gap periods report actual source block boundaries and require two observations", () => {
  const gapped = rows.filter((_, i) => i < 20 || i > 25);
  const result = persistenceCoverage(sample(t), gapped);
  assert.equal(result.maxGapSeconds, 7 * 1800);
  assert.deepEqual(result.gaps, [
    { start: rows[19].observedAt, end: rows[26].observedAt, seconds: 7 * 1800 },
  ]);
  assert.equal(result.ready, false);
  assert.equal(persistenceCoverage(sample(t), [sample(t)]).maxGapSeconds, null);
  assert.equal(persistenceCoverage(sample(t), []).firstObservation, null);
});
test("observed zero fees count while missing fee prices and short fee windows fail the existing gates", () => {
  const zero = rows.map((r) => ({ ...r, eligibleFees48hUsd: 0 }));
  assert.equal(persistenceCoverage(sample(t), zero).pricedFeeCount, 97);
  assert.equal(persistenceCoverage(sample(t), zero).ready, true);
  const sparse = rows.map((r, i) => ({
    ...r,
    eligibleFees48hUsd: i < 18 ? null : 100,
  }));
  assert.equal(persistenceCoverage(sample(t), sparse).pricedFeeCount, 79);
  assert.equal(persistenceCoverage(sample(t), sparse).ready, false);
  assert.equal(
    persistenceCoverage(
      {
        ...sample(t),
        windowStart: t - PERSISTENCE_REQUIREMENTS.minFeeWindowSeconds,
      },
      rows,
    ).ready,
    true,
  );
  assert.equal(
    persistenceCoverage(
      {
        ...sample(t),
        windowStart: t - PERSISTENCE_REQUIREMENTS.minFeeWindowSeconds + 1,
      },
      rows,
    ).ready,
    false,
  );
});
test("market coverage uses full stored history independently of chart requests and leaves frozen forecasts unchanged", () => {
  const store = new Store(":memory:");
  try {
    store.ingest(rows);
    const before = JSON.stringify(store.forecasts("demo"));
    const current = markets(store, "demo")[0];
    const day = store.history("demo", current.snapshot.id, t - 86400, t);
    assert(day.length < current.coverage!.sampleCount);
    assert.equal(current.coverage!.sampleCount, 97);
    assert.equal(current.coverage!.ready, true);
    assert.equal(JSON.stringify(store.forecasts("demo")), before);
  } finally {
    store.close();
  }
});
