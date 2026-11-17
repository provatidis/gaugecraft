import test from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../server/demo.js";
import { Store } from "../server/store.js";
import {
  freezeProspectiveSlot,
  prospectiveEntries,
} from "../server/prospective-store.js";
import {
  nextProspectiveChange,
  prospectivePerformance,
} from "../server/prospective-performance.js";
import {
  PROSPECTIVE_CLOSE,
  PROSPECTIVE_GRACE,
  PROSPECTIVE_HOLD as hold,
  PROSPECTIVE_SLOTS,
  PROSPECTIVE_START as start,
} from "../src/shared/prospective.js";
import type { Snapshot } from "../src/shared/types.js";

function enter(
  store: Store,
  slot: number,
  fees: [number, number],
  same = false,
) {
  const at = start + slot * hold + slot * 1800;
  const samples = (time: number): Snapshot[] =>
    fees.map((amount, i) => ({
      ...demoSnapshot(time, i, at),
      mode: "live",
      allocation: 1000,
      eligibleFees48hUsd: amount,
      incentives48hUsd: 0,
      rewards48hUsd: amount,
      programs: [],
    }));
  const initial = samples(at);
  store.ingest(initial);
  const saved = store.forecasts("live");
  const picks = initial.map((s) =>
    saved.find((f) => f.poolId === s.id && f.madeAt === at)!,
  );
  const [a, b] = picks.map((f) => f.id);
  const choices = {
    persistence: a,
    returning: same ? a : b,
    highestFees: b,
    highestApr: null,
    highestRewards: "absent",
  };
  freezeProspectiveSlot(
    store.db,
    { slot, previousEnd: null },
    at,
    choices,
    picks,
  );
  for (let i = 1; i <= 96; i++) store.ingest(samples(at + i * 1800), false);
  return { at, a, b };
}

test("trial exposes only elapsed slots and releases paired outcomes together after the closing tolerance", () => {
  const store = new Store(":memory:");
  try {
    const { at } = enter(store, 0, [100, 120]);
    const entries = prospectiveEntries(store.db);
    const before = prospectivePerformance(store, start - 1);
    assert.equal(before.slots.length, 0);
    assert.equal(before.nextAt, start);
    assert.equal(nextProspectiveChange(entries, start - 1), start);
    assert.equal(nextProspectiveChange(entries, start), at + hold);
    const enrolled = prospectivePerformance(store, start);
    assert.equal(enrolled.slots[0].status, "holding");
    assert.equal(enrolled.slots[0].picks?.returning.observedReturnProxy, null);
    assert.equal(enrolled.comparisons[0].missing, 0);
    const closing = prospectivePerformance(store, at + hold);
    assert.equal(closing.slots[0].status, "settling");
    assert.equal(closing.slots[1].status, "open");
    assert.equal(
      nextProspectiveChange(entries, at + hold),
      at + hold + PROSPECTIVE_CLOSE,
    );
    const complete = prospectivePerformance(
      store,
      at + hold + PROSPECTIVE_CLOSE,
    );
    assert.equal(complete.slots[0].status, "mature");
    assert.equal(complete.comparable, 1);
    assert.ok(
      Math.abs(complete.slots[0].picks!.persistence.observedReturnProxy! - 50) <
        1e-9,
    );
    assert.ok(
      Math.abs(complete.slots[0].picks!.returning.observedReturnProxy! - 60) <
        1e-9,
    );
    assert.equal(
      complete.slots[0].picks!.highestRewards.reason,
      "The saved forecast is unavailable.",
    );
    const missed = prospectivePerformance(store, at + hold + PROSPECTIVE_GRACE);
    assert.equal(missed.missed, 1);
    assert.equal(missed.slots[1].status, "missed");
    assert.equal(missed.comparisons[0].missing, 1);
    const finished = prospectivePerformance(
      store,
      start + PROSPECTIVE_SLOTS * hold + 1,
    );
    assert.equal(finished.nextAt, null);
    assert.equal(finished.slots.length, PROSPECTIVE_SLOTS);
    assert.equal(finished.missed, PROSPECTIVE_SLOTS - 1);
    assert.equal(
      nextProspectiveChange(entries, start + PROSPECTIVE_SLOTS * hold + 1),
      Infinity,
    );
  } finally {
    store.close();
  }
});

test("paired earnings count same pools, losses, medians and missing benchmark picks on their own denominators", () => {
  const store = new Store(":memory:");
  try {
    enter(store, 0, [100, 120]);
    enter(store, 1, [100, 60]);
    const last = enter(store, 2, [100, 120], true);
    const report = prospectivePerformance(
      store,
      last.at + hold + PROSPECTIVE_CLOSE,
    );
    const cmp = report.comparisons[0];
    assert.deepEqual(
      [cmp.matched, cmp.samePool, cmp.wins, cmp.ties, cmp.losses, cmp.missing],
      [3, 1, 1, 0, 1, 0],
    );
    assert.ok(Math.abs(cmp.medianDifference! - -5) < 1e-9);
    assert.ok(Math.abs(cmp.worstDifference! - -20) < 1e-9);
    assert.equal(report.comparisons.length, 7);
    const apr = report.comparisons.find(
      (c) => c.left === "returning" && c.right === "highestApr",
    )!;
    assert.equal(apr.matched, 0);
    assert.equal(apr.missing, 3);
    assert.equal(apr.medianDifference, null);
    const fees = report.comparisons.find(
      (c) => c.left === "returning" && c.right === "highestFees",
    )!;
    assert.equal(fees.samePool, 2);
    assert.equal(fees.losses, 1);
  } finally {
    store.close();
  }
});
