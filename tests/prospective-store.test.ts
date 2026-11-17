import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { demoSnapshot } from "../server/demo.js";
import { prospectiveEntries } from "../server/prospective-store.js";
import {
  PROSPECTIVE_START as start,
  PROSPECTIVE_HOLD as hold,
  PROSPECTIVE_GRACE as grace,
  PROSPECTIVE_SLOTS as slots,
} from "../src/shared/prospective.js";

function liveSnapshot(at: number, index = 0) {
  return {
    ...demoSnapshot(at, index, start),
    mode: "live" as const,
    programs: [],
  };
}

test("one live decision freezes distinct default and returning picks with its original three benchmarks", () => {
  const store = new Store(":memory:");
  try {
    for (let i = 0; i <= 96; i++) {
      const at = start - (96 - i) * 1800;
      store.ingest([
        {
          ...liveSnapshot(at),
          eligibleFees48hUsd: 10,
          allocation: i < 70 ? 100000 : 0,
        },
        { ...liveSnapshot(at, 1), eligibleFees48hUsd: 4, allocation: 10 },
      ]);
    }
    store.saveDecision("live", start - 1);
    store.saveDecision("demo", start);
    assert.deepEqual(prospectiveEntries(store.db), []);
    store.saveDecision("live", start + 10);
    const entries = prospectiveEntries(store.db);
    assert.equal(entries.length, 1);
    const trial = entries[0];
    const { choices } = store.decisions("live", start + 10 + hold)[0];
    const a = store
      .latestMarketInputs("live")
      .find((row) => row.snapshot.id === liveSnapshot(start).id)!.frozen!;
    const b = store
      .latestMarketInputs("live")
      .find((row) => row.snapshot.id === liveSnapshot(start, 1).id)!.frozen!;
    assert.equal(choices.persistence, a.id);
    assert.deepEqual(trial.choices, { ...choices, returning: b.id });
    assert.deepEqual(
      [trial.slot, trial.at, trial.startAt, trial.dueAt],
      [0, start + 10, start, start + hold],
    );
    store.saveDecision("live", start + 1800);
    assert.deepEqual(prospectiveEntries(store.db), entries);
  } finally {
    store.close();
  }
});

test("actual forecast bounds prevent overlap even when only a benchmark starts early", () => {
  const store = new Store(":memory:");
  const next = start + hold;
  try {
    // The last input available for the first decision arrives 100 seconds after its grid time.
    store.ingest([
      { ...liveSnapshot(start + 100), stakeApr: 1, eligibleFees48hUsd: 10 },
    ]);
    store.saveDecision("live", start + 101);
    store.ingest([
      { ...liveSnapshot(next + 120), stakeApr: 1, eligibleFees48hUsd: 10 },
      { ...liveSnapshot(next + 70, 1), stakeApr: 100, eligibleFees48hUsd: 1 },
    ]);
    store.saveDecision("live", next + 125);
    assert.deepEqual(
      prospectiveEntries(store.db).map((row) => row.slot),
      [0],
    );
    store.ingest([
      { ...liveSnapshot(next + 1810, 1), stakeApr: 100, eligibleFees48hUsd: 1 },
    ]);
    store.saveDecision("live", next + 1815);
    const rows = prospectiveEntries(store.db);
    assert.deepEqual(
      rows.map((row) => row.slot),
      [0, 1],
    );
    assert.equal(rows[1].startAt, next + 120);
    assert.equal(rows[1].dueAt, next + 1810 + hold);
    assert(rows[1].startAt >= rows[0].dueAt);
  } finally {
    store.close();
  }
});

test("missed slots stay empty, missing picks consume a slot, and the trial stops after slot 30", () => {
  const store = new Store(":memory:");
  try {
    store.saveDecision("live", start + grace);
    assert.deepEqual(prospectiveEntries(store.db), []);
    store.saveDecision("live", start + hold + 1);
    store.ingest([liveSnapshot(start + hold + 1800)]);
    store.saveDecision("live", start + hold + 1801);
    store.saveDecision("live", start + (slots - 1) * hold + grace - 1);
    store.saveDecision("live", start + slots * hold);
    const rows = prospectiveEntries(store.db);
    assert.deepEqual(
      rows.map((row) => row.slot),
      [1, slots - 1],
    );
    assert(Object.values(rows[0].choices).every((id) => id === null));
    assert.equal(rows[0].startAt, start + hold + 1);
    assert.equal(rows[0].dueAt, start + 2 * hold + 1);
  } finally {
    store.close();
  }
});

test("a second writer preserves the first decision, enrollment failure rolls back, and older read-only archives still open", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaugecraft-trial-"));
  const file = join(dir, "scratch.sqlite");
  const a = new Store(file);
  const b = new Store(file);
  try {
    a.db.exec(
      "CREATE TRIGGER enrollment_error BEFORE INSERT ON prospective_slots_v1 BEGIN SELECT RAISE(ABORT,'test enrollment failure'); END;",
    );
    assert.throws(
      () => a.saveDecision("live", start),
      /test enrollment failure/,
    );
    assert.equal(b.decisions("live", start + hold).length, 0);
    b.db.exec("DROP TRIGGER enrollment_error");
    b.saveDecision("live", start + 1);
    a.ingest([liveSnapshot(start + 5)]);
    a.saveDecision("live", start + 6);
    assert.equal(prospectiveEntries(a.db)[0].at, start + 1);
    assert.equal(prospectiveEntries(a.db)[0].choices.highestFees, null);
    const restarted = new Store(file);
    try {
      restarted.saveDecision("live", start + 1800);
      assert.deepEqual(
        prospectiveEntries(restarted.db),
        prospectiveEntries(b.db),
      );
      assert.equal(prospectiveEntries(restarted.db)[0].at, start + 1);
    } finally {
      restarted.close();
    }
    // Simulate a database restored from before this experiment existed.
    b.db.exec("DROP TABLE prospective_slots_v1");
    const old = new Store(file, { readOnly: true });
    try {
      assert.deepEqual(prospectiveEntries(old.db), []);
    } finally {
      old.close();
    }
    const reopened = new Store(file);
    try {
      reopened.saveDecision("live", start + 10);
      assert.deepEqual(prospectiveEntries(reopened.db), []);
    } finally {
      reopened.close();
    }
  } finally {
    a.close();
    b.close();
    await rm(dir, { recursive: true, force: true });
  }
});
