import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { demoSnapshot } from "../server/demo.js";
import { exportPages } from "../server/pages-export.js";
import { performance } from "../server/performance.js";

test("Pages export preserves namespaces, historical values, frozen forecasts and the 30-day boundary", async () => {
  const db = new Store(":memory:");
  const dir = await mkdtemp(join(tmpdir(), "gaugecraft-pages-"));
  const now = 1792656000;
  const sample = demoSnapshot(now);
  const frozenEnd = now - 90 * 86400;
  const olderFixture = demoSnapshot(frozenEnd, 1);
  const live = {
    ...sample,
    mode: "live" as const,
    allocation: 12345,
    raw: { large: "source payload" },
  };
  db.ingest([
    sample,
    olderFixture,
    demoSnapshot(frozenEnd - 30 * 86400, 1),
    demoSnapshot(frozenEnd - 31 * 86400, 1),
    live,
    { ...live, observedAt: now - 31 * 86400, retrievedAt: now - 31 * 86400 },
  ]);
  const before = db.forecasts("live");
  try {
    await exportPages(db, dir, now);
    const state = JSON.parse(
      await readFile(join(dir, "data/live/state.json"), "utf8"),
    );
    assert.equal(state.collectionKind, "github-actions");
    assert.equal(state.markets.length, 1);
    assert.equal(state.markets[0].snapshot.mode, "live");
    assert.equal(state.markets[0].snapshot.allocation, 12345);
    const overview = JSON.parse(
      await readFile(join(dir, "data/live/overview.json"), "utf8"),
    );
    assert.equal(overview.markets[0].forecast.input, undefined);
    overview.markets[0].forecast.input = overview.markets[0].snapshot;
    assert.deepEqual(overview, state);
    const demo = JSON.parse(
      await readFile(join(dir, "data/demo/state.json"), "utf8"),
    );
    assert.equal(demo.markets[0].snapshot.mode, "demo");
    assert.notEqual(demo.markets[0].snapshot.allocation, 12345);
    const fixtureChart = JSON.parse(
      await readFile(
        join(
          dir,
          `data/demo/history/${olderFixture.id.replace(":", "-")}.json`,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      fixtureChart.map((p: { observedAt: number }) => p.observedAt),
      [frozenEnd - 30 * 86400, frozenEnd],
    );
    const fixtureCsv = await readFile(
      join(dir, "data/demo/observations.csv"),
      "utf8",
    );
    assert.equal(fixtureCsv.trim().split("\n").length, 4);
    assert.ok(fixtureCsv.includes(new Date(frozenEnd * 1000).toISOString()));
    assert.ok(
      !fixtureCsv.includes(
        new Date((frozenEnd - 31 * 86400) * 1000).toISOString(),
      ),
    );
    const history = JSON.parse(
      await readFile(
        join(dir, `data/live/history/${live.id.replace(":", "-")}.json`),
        "utf8",
      ),
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].observedAt, now);
    assert.equal(history[0].allocation, 12345);
    assert.equal(history[0].blockHash, live.blockHash);
    assert.equal(history[0].raw, undefined);
    const csv = await readFile(join(dir, "data/live/observations.csv"), "utf8");
    assert.equal(csv.trim().split("\n").length, 2);
    assert.equal(csv.includes('"demo"'), false);
    assert.deepEqual(
      JSON.parse(
        await readFile(join(dir, "data/live/performance.json"), "utf8"),
      ),
      performance(db, "live", now),
    );
    assert.deepEqual(db.forecasts("live"), before);
    assert.equal(db.all("live").length, 2);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
