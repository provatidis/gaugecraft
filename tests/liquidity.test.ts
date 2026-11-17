import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  quote,
  choices,
  value,
  costs,
  exposure,
  stableCounters,
  displayApr,
  type Counter,
  pools,
  WEEK,
  type Terms,
  type Point,
  type Pool,
} from "../src/analysis/liquidity.js";
import {
  restoreLedger,
  verifyLedger,
  score,
  type Frozen,
} from "../server/lp-pilot.js";
const terms: Terms = {
  alive: true,
  paying: true,
  feeApr: 10,
  aeroApr: 20,
  referral: 0,
  penalty: 1,
  minBlocks: 70,
};
function tape(pool: Pool, price: number, change = 1): Point[] {
  return Array.from({ length: 29 }, (_, i) => {
    const spot = price * change ** (i / 28);
    const sqrt = Math.sqrt(pool.asset === "WETH" ? spot / 1e12 : 100 / spot);
    return {
      at: 1e9 + i * 21600,
      block: 1e7 + i * 10000,
      hash: "block" + i,
      aeroUsd: 0.42,
      samples: {
        [pool.address]: {
          tick: Math.floor((2 * Math.log(sqrt)) / Math.log(1.0001)),
          sqrt,
          liquidity: 1e23,
          staked: 1e23,
          growth: ["0", "0", "0"],
        },
      },
    };
  });
}
for (const [pool, spot] of [
  [pools[0], 1900],
  [pools[2], 64000],
] as const) {
  test(
    pool.asset + " token order, dollar principal and identical opening hold",
    () => {
      const series = tape(pool, spot),
        q = quote(pool, 8, series[0], series, terms, false)!;
      assert.ok(Math.abs(q.spot - spot) < 1e-6);
      assert.ok(Math.abs(q.units * spot + q.stable - 1) < 1e-10);
      assert.ok(Math.abs(q.principal - 1) < 1e-10);
      assert.ok(Math.abs(q.hold - 1) < 1e-10);
      assert.equal(q.inRange, 1);
      assert.ok(
        Math.abs(value(q, "fees", 1000)! - (1000 - costs(1000))) < 1e-6,
      );
      assert.equal(choices([q], pool.asset, "weekly", 1000).pick?.mode, "hold");
      assert.equal(choices([q], pool.asset, "weekly", 1000).headline, null);
      const crash = tape(pool, spot, 0.7),
        loss = quote(pool, 8, crash[0], crash, terms, false)!;
      assert.ok(loss.principal < loss.hold);
      assert.ok(
        Math.abs(loss.hold - (loss.units * spot * 0.7 + loss.stable)) < 1e-10,
      );
      assert.ok(loss.lowUsd < spot && loss.highUsd > spot);
    },
  );
}
test("growth modes, coverage, size and counter continuity", () => {
  const p = pools[0],
    series = tape(p, 1900);
  const last = series.at(-1)!;
  last.samples[p.address]!.growth = ["10", "20", "30"];
  const q = quote(p, 8, series[0], series, terms, false)!;
  assert.ok(q.fees! > 0);
  assert.ok(q.aero! > 0);
  assert.equal(value(q, "aero", q.aeroLimit + 1), null);
  assert.equal(
    quote(p, 8, last, series, { ...terms, paying: false }, true)!.aero,
    null,
  );
  assert.equal(quote(p, 8, series[0], series.slice(1), terms, false), null);
  assert.equal(exposure(0, 10, 2, 5), 0.3);
  assert.equal(exposure(10, 0, 2, 5), 0.3);
  const a = {
    above: [WEEK * 2, WEEK * 2] as [number, number],
    growth: ["0", "0", "0"] as [string, string, string],
  };
  const b = { ...a, growth: ["5", "10", "15"] as [string, string, string] };
  assert.equal(stableCounters([a, b], series[0], last, p.address), true);
  assert.equal(
    stableCounters([a, { ...b, above: [0, 0] }], series[0], last, p.address),
    false,
  );
  assert.equal(
    stableCounters(
      [a, { ...b, growth: ["11", "0", "0"] }],
      series[0],
      last,
      p.address,
    ),
    false,
  );
});
test("a frozen fee choice uses verified range growth despite a missing intermediate sample and gauge terms", async () => {
  const pool = pools[0],
    series = tape(pool, 1900);
  const point = series[0],
    end = series.at(-1)!;
  const opening = quote(pool, 8, point, series, terms, false)!;
  const fees = { address: pool.address, width: 8, mode: "fees" } as const;
  const key = pool.address + "-8";
  const initial: Counter = {
    above: [WEEK * 2, WEEK * 2],
    growth: ["0", "0", "0"],
  };
  const closing: Counter = {
    above: [WEEK * 3, WEEK * 2],
    growth: [(2n ** 128n).toString(), "0", "0"],
  };
  end.samples[pool.address]!.growth = [...closing.growth];
  const frozen: Frozen = {
    point,
    terms: { [pool.address]: terms },
    counters: { [key]: initial },
    decision: {
      at: point.at,
      published: point.at,
      block: point.block,
      hash: point.hash,
      quotes: [opening],
      entries: [
        {
          asset: pool.asset,
          preset: "weekly",
          pick: fees,
          headline: { ...fees, mode: "aero" },
        },
      ],
    },
  };
  const reader = {
    async terms() {
      return {};
    },
    async counters() {
      return { [key]: closing };
    },
  };
  const full = await score(reader, frozen, series);
  series[1].samples[pool.address] = null;
  const withGap = (await score(reader, frozen, series)).entries[0].score!;
  assert.equal(withGap.pickEvidence, "range counters");
  assert.ok(withGap.pickNet !== null && withGap.pickNet > 1000 - costs(1000));
  assert.deepEqual(withGap, full.entries[0].score);
  assert.equal(withGap.headlineNet, null);
  const withoutCounters = await score(
    {
      ...reader,
      async counters() {
        return {};
      },
    },
    frozen,
    series,
  );
  assert.equal(withoutCounters.entries[0].score?.pickNet, null);
  assert.ok(Math.abs(withoutCounters.entries[0].score!.hold! - 1000) < 1e-6);
  const delayed = series.map((p) => ({ ...p, at: p.at + 30 }));
  assert.equal((await score(reader, frozen, delayed)).outcomeAt, end.at + 30);
  delayed.at(-1)!.at += 40;
  await assert.rejects(score(reader, frozen, delayed), /horizon mismatch/);
});
test("the LP list and headline benchmark use the same capped displayed APR", () => {
  assert.equal(displayApr(0.0371), "0.04");
  assert.equal(displayApr(15.425), "15.4");
  assert.equal(displayApr(200.45), "200");
  assert.equal(displayApr(9500), "9000");
  assert.equal(displayApr(null), null);
  const qs = pools.slice(0, 2).map((pool) => {
    const series = tape(pool, 1900);
    return quote(
      pool,
      8,
      series[0],
      series,
      { ...terms, feeApr: 9001, aeroApr: 9200 },
      true,
    )!;
  });
  const result = choices(qs, "WETH", "weekly", 1000);
  assert.deepEqual(result.headline, {
    address: [...qs].sort((a, b) => a.address.localeCompare(b.address))[0]
      .address,
    width: 8,
    mode: "aero",
  });
});
test("LP archive round trip restores independently and detects corruption", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lp-archive-"));
  try {
    const body = JSON.stringify({ version: 1, days: [] }),
      file = join(dir, "source");
    await writeFile(file, body);
    const objects = new Map<string, Buffer>();
    const store = {
      async put(key: string, f: string) {
        objects.set(key, await readFile(f));
      },
      async read(key: string) {
        return (async function* () {
          yield objects.get(key)!;
        })();
      },
    };
    await verifyLedger(store, file, body);
    assert.equal((await restoreLedger(store)).body, body);
    await assert.rejects(verifyLedger(store, file, body + " "));
    objects.set("lp-pilot/base-v1/latest.json", Buffer.from("{}"));
    await assert.rejects(restoreLedger(store));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
