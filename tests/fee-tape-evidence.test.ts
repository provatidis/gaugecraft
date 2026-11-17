import test from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../server/demo.js";
import {
  feeTapeReader,
  feeTapeRevision,
  feeTapeWorker,
} from "../server/fee-tape-evidence.js";
import { Store } from "../server/store.js";
import { freezeProspectiveSlot } from "../server/prospective-store.js";
import { PROSPECTIVE_START } from "../src/shared/prospective.js";
import { HORIZON } from "../src/analysis/math.js";
import type { Snapshot } from "../src/shared/types.js";

const origin = 1792656000;
const maturity = origin + HORIZON + 20;
const observed = (t: number, i = 0): Snapshot => ({
  ...demoSnapshot(t, i),
  mode: "live",
  block: String(t),
  blockHash: "0x" + t.toString(16).padStart(64, "0"),
  retrievedAt: t + 20,
});
function seed(db: Store, aligned = false, index = 0, at = origin) {
  const start = observed(at, index),
    closing = observed(at + HORIZON, index),
    next = observed(at + HORIZON + 1800, index);
  if (!aligned) next.windowStart += 2 * 3600;
  db.ingest([start]);
  db.ingest([closing, next], false);
  const selected = db.forecasts("live").find((f) => f.poolId === start.id)!;
  return { start, closing, selected };
}
function decision(db: Store, ids: (string | null)[]) {
  db.db
    .prepare("INSERT INTO decisions VALUES('live',?,?,?)")
    .run(
      Math.floor(origin / 1800),
      origin + 30,
      JSON.stringify(
        Object.fromEntries(
          ["highestFees", "highestApr", "highestRewards", "persistence"].map(
            (rule, i) => [rule, ids[i] ?? null],
          ),
        ),
      ),
    );
}
const now = maturity + 1800;
const point = (s: Snapshot) => ({
  blockHash: s.blockHash,
  tape: "0x" + "1".repeat(40),
  fee0: s.block,
  fee1: "0",
  lastSwapAt: s.observedAt,
});

test("mature trial picks can obtain missing fee evidence outside the rolling decision sample", async () => {
  const db = new Store(":memory:");
  try {
    const { selected, start, closing } = seed(db, false, 0, PROSPECTIVE_START);
    freezeProspectiveSlot(
      db.db,
      { slot: 0, previousEnd: null },
      selected.madeAt,
      {
        persistence: null,
        returning: selected.id,
        highestApr: null,
        highestFees: null,
        highestRewards: null,
      },
      [selected],
    );
    const work = feeTapeWorker(db, {
      supports: () => true,
      read: async (s) => point(s),
    });
    const signal = new AbortController().signal;
    assert.equal((await work(selected.dueAt - 1, signal)).reads, 0);
    const after = selected.dueAt + 7 * 86400;
    assert.deepEqual(db.decisions("live", after), []);
    assert.equal((await work(after, signal)).added, 2);
    assert.deepEqual(feeTapeReader(db.db)(start), point(start));
    assert.deepEqual(feeTapeReader(db.db)(closing), point(closing));
  } finally {
    db.close();
  }
});
test("historical evidence reads only unaligned saved selections, deduplicates blocks and survives worker restart", async () => {
  const db = new Store(":memory:");
  try {
    const needed = seed(db),
      aligned = seed(db, true, 1),
      unselected = seed(db, false, 2);
    decision(db, [
      needed.selected.id,
      needed.selected.id,
      aligned.selected.id,
      needed.selected.id,
    ]);
    assert.equal(feeTapeRevision(db.db), 0);
    assert.equal(feeTapeReader(db.db)(needed.start), null);
    const calls: Snapshot[] = [];
    const source = {
      supports: () => true,
      read: async (s: Snapshot) => {
        calls.push(s);
        return point(s);
      },
    };
    await feeTapeWorker(db, source)(now, new AbortController().signal);
    assert.deepEqual(
      calls.map((s) => s.blockHash),
      [needed.start.blockHash, needed.closing.blockHash],
    );
    assert.ok(calls.every((s) => s.id === needed.start.id));
    assert.equal(feeTapeRevision(db.db), 2);
    const lookup = feeTapeReader(db.db);
    assert.deepEqual(lookup(needed.start), point(needed.start));
    assert.equal(lookup({ ...needed.start, mode: "demo" }), null);
    assert.equal(lookup(unselected.start), null);
    await feeTapeWorker(db, source)(now, new AbortController().signal);
    assert.equal(calls.length, 2);
    assert.equal(feeTapeRevision(db.db), 2);
  } finally {
    db.close();
  }
});

test("partial backfills resume after provider backoff without fetching the successful block again", async () => {
  const db = new Store(":memory:");
  try {
    const needed = seed(db);
    decision(db, [needed.selected.id]);
    const calls: string[] = [];
    const work = feeTapeWorker(db, {
      supports: () => true,
      async read(s) {
        calls.push(s.block);
        if (calls.length === 2) throw new Error("temporary provider failure");
        return point(s);
      },
    });
    const signal = new AbortController().signal;
    await work(now, signal, () => true);
    assert.equal(calls.length, 0);
    await work(now, signal);
    assert.equal(feeTapeRevision(db.db), 1);
    await work(now + 10, signal);
    assert.equal(calls.length, 2);
    await work(now + 301, signal);
    assert.deepEqual(calls, [
      needed.start.block,
      needed.closing.block,
      needed.closing.block,
    ]);
    assert.equal(feeTapeRevision(db.db), 2);
  } finally {
    db.close();
  }
});

test("cancellation during a historical read never saves an unverified or late response", async () => {
  const db = new Store(":memory:");
  try {
    const needed = seed(db);
    decision(db, [needed.selected.id]);
    const abort = new AbortController();
    const run = feeTapeWorker(db, {
      supports: () => true,
      async read(s) {
        abort.abort();
        return point(s);
      },
    });
    await run(now, abort.signal);
    assert.equal(feeTapeRevision(db.db), 0);
  } finally {
    db.close();
  }
});

test("the ten-block budget defers remaining selected history to the next pass", async () => {
  const db = new Store(":memory:");
  try {
    const choices = Array.from({ length: 7 }, (_, i) =>
      observed(origin + i * 1800),
    );
    db.ingest(choices);
    const forecasts = db.forecasts("live");
    for (const f of forecasts) {
      db.db
        .prepare("INSERT INTO decisions VALUES('live',?,?,?)")
        .run(
          Math.floor(f.madeAt / 1800),
          f.madeAt,
          JSON.stringify({ highestFees: f.id }),
        );
    }
    const ends = Array.from({ length: 8 }, (_, i) => {
      const s = observed(origin + HORIZON + i * 1800);
      s.windowStart = s.observedAt - 24 * 3600;
      return s;
    });
    db.ingest(ends, false);
    const signal = new AbortController().signal;
    const work = feeTapeWorker(db, {
      supports: () => true,
      read: async (s) => point(s),
    });
    const at = ends.at(-1)!.retrievedAt + 1;
    const pass = await work(at, signal);
    assert.equal(pass.reads, 10);
    assert.equal(pass.pending, true);
    assert.equal(feeTapeRevision(db.db), 10);
    const next = await work(at + 5, signal);
    assert.equal(next.reads, 4);
    assert.equal(next.pending, false);
    assert.equal(feeTapeRevision(db.db), 14);
  } finally {
    db.close();
  }
});
