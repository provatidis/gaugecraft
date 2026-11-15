import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { demoSnapshot } from "../server/demo.js";
import { collect } from "../server/collector.js";
import { poolId } from "../server/sources/aero.js";
import { toCsv } from "../server/csv.js";
import { derivePrices } from "../server/sources/prices.js";
import { markets } from "../server/markets.js";
const t = 1792656000;
test("disabling forecast storage keeps current market inputs and the frozen ledger separate", () => {
  const db = new Store(":memory:");
  db.ingest([demoSnapshot(t)]);
  const original = db.forecasts("demo")[0];
  db.ingest(
    [{ ...demoSnapshot(t + 21600), allocation: 1000, eligibleFees48hUsd: 100 }],
    false,
  );
  const current = markets(db, "demo")[0];
  assert.equal(current.forecast.madeAt, t + 21600);
  assert.equal(current.forecast.input.allocation, 1000);
  assert.equal(current.forecast.projectedFees, 100);
  assert.notEqual(current.allocationChange, null);
  assert.deepEqual(db.forecasts("demo"), [original]);
  db.close();
});
test("transactional idempotence, chain-aware identities and fixture isolation", () => {
  const db = new Store(":memory:"),
    a = demoSnapshot(t);
  assert.equal(db.ingest([a, a]), 1);
  assert.equal(
    db.ingest([
      { ...a, observedAt: t + 10, retrievedAt: t + 10, rewards48hUsd: 999 },
    ]),
    0,
  );
  assert.equal(db.latest("demo").length, 1);
  assert.equal(db.latest("live").length, 0);
  assert.equal(db.forecasts("demo").length, 1);
  const b = { ...a, chainId: 10, id: poolId(10, a.address) };
  assert.equal(db.ingest([b]), 1);
  assert.equal(db.latest("demo").length, 2);
  assert.throws(() =>
    db.ingest([
      { ...a, observedAt: t + 1800, retrievedAt: t + 1800 },
      { ...a, id: "invalid" },
    ]),
  );
  assert.equal(db.history("demo", a.id).length, 1);
  db.close();
});
test("collection failure preserves last good data and is visible", async () => {
  const db = new Store(":memory:");
  const s = { ...demoSnapshot(t), mode: "live" as const };
  db.ingest([s]);
  const result = await collect(
    db,
    {
      collect: async () => {
        throw new Error("unavailable");
      },
    },
    [8453],
  );
  assert.equal(result.runs[0].error, "unavailable");
  assert.equal(db.latest("live").length, 1);
  assert.equal(db.runs("live")[0].status, "error");
  db.close();
});
test("collector validates source, ingests snapshots, and freezes benchmark decisions", async () => {
  const db = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const s = { ...demoSnapshot(now), mode: "live" as const };
  const result = await collect(
    db,
    {
      collect: async () => ({ snapshots: [s], registryCount: 1, warnings: [] }),
    },
    [8453],
  );
  assert.equal(result.runs[0].added, 1);
  assert.equal(db.runs("live")[0].status, "success");
  assert.equal(db.forecasts("live").length, 1);
  assert.equal(db.db.prepare("SELECT count(*) n FROM decisions").get()!.n, 1);
  db.close();
});
test("collector lease prevents overlapping processes", () => {
  const db = new Store(":memory:");
  assert.equal(db.acquire(t), true);
  assert.equal(db.acquire(t + 60), false);
  assert.equal(db.acquire(t + 1201), true);
  db.release();
  assert.equal(db.acquire(t + 1202), true);
  db.close();
});
test("interrupted collector recovery preserves observations and release cannot delete another owner", () => {
  const db = new Store(":memory:");
  db.ingest([demoSnapshot(t)]);
  db.startRun(8453, "live", t);
  db.db
    .prepare("INSERT INTO leases(name,until) VALUES(?,?)")
    .run("collector", t + 1200);
  assert.equal(db.acquire(t + 1), true);
  assert.equal(db.runs("live")[0].status, "error");
  assert.equal(db.latest("demo").length, 1);
  db.db.prepare("UPDATE leases SET owner=?").run("replacement");
  db.release();
  assert.equal(
    db.db.prepare("SELECT owner FROM leases").get()!.owner,
    "replacement",
  );
  db.close();
});
test("CSV is UTC, handles quotes, and neutralizes spreadsheet formulas", () => {
  const s = demoSnapshot(t);
  s.token0.symbol = '=IMPORTXML("unsafe")';
  const csv = toCsv([s]);
  assert.ok(csv.includes("'=IMPORTXML("));
  assert.ok(csv.includes("2026-10-22T08:00:00.000Z"));
  assert.ok(csv.includes("eligible_fees_window_usd_estimate"));
});
test("prices require depth and do not infer unknown stablecoins from a ticker", () => {
  const stable = "0xstable",
    token = "0xtoken";
  const tokens = new Map([
    [stable, { address: stable, symbol: "USDC", decimals: 6 }],
    [token, { address: token, symbol: "USDC", decimals: 18 }],
  ]);
  const p = {
    lp: "pool",
    token0: token,
    token1: stable,
    reserve0: 100n * 10n ** 18n,
    reserve1: 2000n * 10n ** 6n,
    poolType: -1,
    sqrtRatio: 0n,
  };
  assert.equal(derivePrices([p], tokens, stable)[token].usd, 20);
  assert.equal(
    derivePrices([{ ...p, reserve1: 10n }], tokens, stable)[token],
    undefined,
  );
  assert.equal(
    derivePrices([{ ...p, poolType: 0 }], tokens, stable)[token],
    undefined,
  );
});

test("daily collection history separates retries, failures and missing pool counts at UTC boundaries", () => {
  const db = new Store(":memory:");
  const end = 18000 * 86400;
  const day = end - 86400;
  try {
    const add = (
      chain: number,
      at: number,
      count: number,
      status: "success" | "error" | "partial",
      mode: "live" | "demo" = "live",
    ) => {
      const id = db.startRun(chain, mode, at);
      db.finishRun(id, status, count, null, at + 1);
    };
    add(1, end - 21 * 86400 - 1, 100, "success");
    add(1, end - 21 * 86400, 25, "success");
    add(1, day, 29, "success");
    add(1, day + 1, 30, "success");
    add(1, day + 2, 0, "error");
    add(1, day + 1800, 19, "partial");
    add(1, day + 1801, 99, "success", "demo");
    add(1, end, 99, "success");
    db.startRun(2, "live", day + 20);
    const report = db.collectionDays(end);
    assert.equal(report.networks.length, 3);
    assert.equal(report.networks[0].lastSuccessfulPoolCount, 25);
    assert.deepEqual(
      { ...report.networks[1] },
      {
        day: new Date(day * 1000).toISOString().slice(0, 10),
        chainId: 1,
        attempts: 4,
        successful: 2,
        partial: 1,
        failed: 1,
        running: 0,
        attemptedHalfHours: 2,
        lastSuccessfulPoolCount: 30,
      },
    );
    assert.equal(report.networks[2].lastSuccessfulPoolCount, null);
    assert.equal(report.networks[2].running, 1);
  } finally {
    db.close();
  }
});

test("bounded performance samples retain the original picks when many pools share the cutoff timestamp", () => {
  const db = new Store(":memory:");
  try {
    const cohort = (at: number, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const snapshot = demoSnapshot(at);
        const address = `0x${(count - i).toString(16).padStart(40, "0")}`;
        return { ...snapshot, id: poolId(snapshot.chainId, address), address };
      });
    const mature = cohort(t, 501);
    const pending = cohort(t + 86400, 251);
    db.ingest([...mature, ...pending]);
    const saved = db.db
      .prepare("SELECT id FROM forecasts WHERE pool_id=? AND made_at=?")
      .get(mature[500].id, t)!.id as string;
    const selected = db.evaluationForecasts(
      "demo",
      t + 48 * 3600,
      [saved],
      false,
    );
    assert.deepEqual(
      selected.map((f) => [f.madeAt, f.poolId]),
      [...pending.slice(0, 250), ...mature.slice(0, 500), mature[500]].map(
        (s) => [s.observedAt, s.id],
      ),
    );
  } finally {
    db.close();
  }
});
