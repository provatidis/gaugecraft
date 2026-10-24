import test from "node:test";
import assert from "node:assert/strict";
import { findPools } from "../src/client/pool-search.js";
import { demoSnapshot } from "../server/demo.js";
import { forecast } from "../src/analysis/forecast.js";
import type { MarketRow } from "../src/shared/types.js";

function row(
  chainId: number,
  chain: string,
  address: string,
  rewards: number,
): MarketRow {
  const snapshot = {
    ...demoSnapshot(1792656000),
    chainId,
    chain,
    address,
    id: `${chainId}:${address}`,
    token0: { address: "0xtoken-weth", symbol: "WETH", decimals: 18 },
    token1: { address: "0xtoken-usdc", symbol: "USDC", decimals: 6 },
    rewards48hUsd: rewards,
  };
  return {
    snapshot,
    forecast: forecast(snapshot, []),
    aprChange: null,
    allocationChange: null,
  };
}
const base = row(
  8453,
  "Base",
  "0xABC0000000000000000000000000000000000001",
  10,
);
const op = row(10, "OP", base.snapshot.address, 100);
const other = row(
  8453,
  "Base",
  "0xDEF0000000000000000000000000000000000002",
  50,
);
const rows = [base, op, other];

test("pool search combines case-insensitive tokens, pair separators and network terms", () => {
  assert.deepEqual(
    findPools(rows, "  usdc/WETH Base ", "", []).map((r) => r.snapshot.id),
    [other.snapshot.id, base.snapshot.id],
  );
  assert.equal(
    findPools(rows, "USDC WETH 10", "", [])[0].snapshot.id,
    op.snapshot.id,
  );
  assert.equal(findPools(rows, "missing-token", "", []).length, 0);
  assert.equal(rows[0], base, "search must not reorder source rows");
});
test("addresses and full chain-aware identities disambiguate repeated pairs", () => {
  assert.equal(
    findPools(rows, base.snapshot.address.toLowerCase(), "", []).length,
    2,
  );
  assert.deepEqual(
    findPools(rows, base.snapshot.id.toLowerCase(), "", []).map(
      (r) => r.snapshot.id,
    ),
    [base.snapshot.id],
  );
  assert.equal(findPools(rows, "0xtoken-usdc", "", []).length, 3);
  const ethereum = row(1, "Ethereum", base.snapshot.address, 10);
  const arbitrum = row(42161, "Arbitrum", base.snapshot.address, 100);
  assert.deepEqual(
    findPools([arbitrum, ethereum], ethereum.snapshot.id, "", []).map(
      (r) => r.snapshot.id,
    ),
    [ethereum.snapshot.id],
    "a chain ID must not match the suffix of another chain ID",
  );

  const tokenMatch = {
    ...op,
    snapshot: {
      ...op.snapshot,
      token0: { ...op.snapshot.token0, address: other.snapshot.address },
    },
  };
  assert.equal(
    findPools(
      [tokenMatch, other],
      other.snapshot.address,
      tokenMatch.snapshot.id,
      [tokenMatch.snapshot.id],
    )[0].snapshot.id,
    other.snapshot.id,
  );
});
test("current pool and chain-aware watchlist are easy to revisit without bypassing search", () => {
  assert.deepEqual(
    findPools(rows, "", base.snapshot.id, [other.snapshot.id]).map(
      (r) => r.snapshot.id,
    ),
    [base.snapshot.id, other.snapshot.id, op.snapshot.id],
  );
  assert.deepEqual(
    findPools(rows, "", "", [base.snapshot.id], true).map((r) => r.snapshot.id),
    [base.snapshot.id],
  );
  assert.equal(
    findPools(rows, "OP", base.snapshot.id, [base.snapshot.id], true).length,
    0,
  );
  assert.equal(findPools(rows, "", "", [], true).length, 0);
});
