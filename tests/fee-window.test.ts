import test from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../server/demo.js";
import { forecast, evaluateForecast } from "../src/analysis/forecast.js";
import type { FeeTapePoint, Snapshot } from "../src/shared/types.js";

const origin = 1792656000;
const history: Snapshot[] = Array.from({ length: 98 }, (_, i) => {
  const at = origin + i * 1800;
  return {
    ...demoSnapshot(at),
    mode: "live",
    block: String(i + 1),
    blockHash: "0x" + (i + 1).toString(16).padStart(64, "0"),
    retrievedAt: at + 21,
    allocation: 1000,
    stakedFraction: 0.5,
    eligibleFees48hUsd: 800,
    windowStart: at - 42 * 3600,
    programs: [],
  };
});
const f = forecast(history[0], [history[0]]);
const closing = history[96],
  endpoint = history[97];
const base = 10n ** 32n;
function point(s: Snapshot): FeeTapePoint {
  const end = s === closing;
  return {
    tape: "0x01",
    blockHash: s.blockHash,
    lastSwapAt: s.observedAt - 1,
    fee0: (base + (end ? 10n ** 18n : 0n)).toString(),
    fee1: (base + (end ? 100n * 10n ** 6n : 0n)).toString(),
  };
}
const evaluate = (
  rows: Snapshot[] = history,
  read: (s: Snapshot) => FeeTapePoint | null = point,
) => evaluateForecast(f, rows, endpoint.retrievedAt, read);

test("a short rolling window is replaced by one verified integer fee difference at endpoint marks, eligibility and dilution", () => {
  const valuation = {
    ...endpoint,
    prices: {
      ...endpoint.prices,
      [endpoint.token0.address]: {
        ...endpoint.prices[endpoint.token0.address],
        usd: 2000,
      },
    },
  };
  const e = evaluate([...history.slice(0, -1), valuation]);
  assert.equal(e.status, "proxy");
  assert.equal(e.observedRevenueProxy, 1050);
  assert.ok(Math.abs(e.observedReturnProxy! - 525) < 1e-9);
  assert.equal(e.feeWindowEvidence?.endHash, closing.blockHash);
  assert.equal(e.feeWindowEvidence?.startHash, history[0].blockHash);
  assert.equal(e.feeWindowEvidence?.fee1Raw, "100000000");
  assert.equal(e.feeWindowEvidence?.fee0Raw, "1000000000000000000");
  assert.equal(
    evaluateForecast(f, history, endpoint.retrievedAt).status,
    "insufficient",
  );
});

test("aligned historical observations retain their original proxy without consulting counter evidence", () => {
  const near = { ...endpoint, windowStart: f.madeAt, windowEnd: f.dueAt };
  const e = evaluate([...history.slice(0, -1), near], () => {
    throw Error("unexpected lookup");
  });
  assert.equal(e.observedRevenueProxy, 800);
  assert.equal(e.feeWindowEvidence, undefined);
});

test("the fee fallback abstains when an endpoint, identity, canonical hash, price or monotone counter is missing", () => {
  const invalidReads: ((s: Snapshot) => FeeTapePoint | null)[] = [
    (s) => (s === closing ? null : point(s)),
    (s) => ({ ...point(s), blockHash: "wrong" }),
    (s) => ({ ...point(s), tape: s === closing ? "other" : "first" }),
    (s) => ({ ...point(s), fee0: s === closing ? "0" : base.toString() }),
    (s) => ({ ...point(s), fee1: "-1" }),
    (s) => ({ ...point(s), lastSwapAt: 0 }),
    (s) => ({ ...point(s), lastSwapAt: origin - 1 }),
  ];
  for (const read of invalidReads)
    assert.equal(evaluate(history, read).status, "insufficient");
  assert.equal(
    evaluate(history.filter((s) => s !== closing)).status,
    "insufficient",
  );
  assert.equal(
    evaluate([...history.slice(0, -1), { ...endpoint, prices: {} }]).status,
    "insufficient",
  );
  assert.equal(
    evaluate([
      ...history.slice(0, -1),
      { ...endpoint, rewardsManager: "different" },
    ]).status,
    "insufficient",
  );
  assert.equal(
    evaluate(history.filter((_, i) => i < 40 || i > 46)).status,
    "insufficient",
  );
  assert.equal(evaluate(history.slice(0, -1)).status, "insufficient");
  assert.equal(
    evaluate([...history.slice(0, -1), { ...endpoint, programs: null }]).status,
    "insufficient",
  );
});

test("genuinely flat counters can establish zero gross fees without token prices", () => {
  const e = evaluate(
    [...history.slice(0, -1), { ...endpoint, prices: {} }],
    (s) => ({ ...point(s), fee0: "2", fee1: "5" }),
  );
  assert.equal(e.status, "proxy");
  assert.equal(e.observedReturnProxy, 0);
});
