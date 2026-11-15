import test from "node:test";
import assert from "node:assert/strict";
import { readRoute, routeHash } from "../src/client/research-route.js";

test("shareable Markets links round-trip the shortlist and pagination", () => {
  const hash =
    "#markets?mode=live&q=USDC+Base&network=Base&evidence=history&watch=1&page=3";
  const route = readRoute(hash);
  assert.deepEqual(route.market, {
    search: "USDC Base",
    chain: "Base",
    evidence: "history",
    starred: true,
    page: 2,
  });
  assert.equal(routeHash(route), hash);
});
test("pool links preserve chain identity and scenario without exposing personal inputs", () => {
  const id = "8453:0xabcdef0000000000000000000000000000000001";
  const route = readRoute(
    `#simulator?mode=demo&pool=${id.toUpperCase()}&scenario=stress&power=12345&stakeValueUsd=98765`,
  );
  assert.equal(route.pool, id);
  const hash = routeHash(route);
  assert.equal(readRoute(hash).scenario, "stress");
  assert.equal(readRoute(hash).mode, "demo");
  assert.ok(!hash.includes("12345") && !hash.includes("98765"));
});
test("invalid routes fall back safely and cap untrusted filter values", () => {
  const route = readRoute(
    "#nope?mode=invalid&pool=javascript:bad&evidence=unknown&page=-9&scenario=unknown",
  );
  assert.equal(route.page, "markets");
  assert.equal(route.mode, "live");
  assert.equal(route.pool, "");
  assert.equal(route.market.page, 0);
  assert.equal(route.market.evidence, "all");
  assert.equal(route.scenario, "forecast");
  assert.equal(
    readRoute("#markets?q=" + "x".repeat(500)).market.search.length,
    200,
  );
  assert.equal(readRoute("#markets?page=Infinity").market.page, 0);
  assert.equal(readRoute("#analysis", "demo").mode, "demo");
});
test("the landing shortlist keeps its network when linked directly", () => {
  assert.equal(readRoute("").page, "opportunities");
  const route = readRoute("#opportunities?mode=live&network=OP+Mainnet");
  assert.equal(route.market.chain, "OP Mainnet");
  assert.deepEqual(readRoute(routeHash(route)), route);
  assert.equal(readRoute("#markets").page, "markets");
});
test("two-pool comparison links restore the current selection without personal settings", () => {
  const first = "8453:0xabcdef0000000000000000000000000000000001";
  const second = "8453:0xabcdef0000000000000000000000000000000002";
  for (const compare of ["choose", first]) {
    const route = readRoute(`#opportunities?network=Base&compare=${compare}`);
    assert.equal(route.compareWith, compare);
    assert.deepEqual(readRoute(routeHash(route)), route);
  }
  const pair = readRoute(
    `#simulator?mode=demo&pool=${first}&compare=${second}&power=42123&percent=35`,
  );
  assert.equal(pair.pool, first);
  assert.equal(pair.compareWith, second);
  assert.deepEqual(readRoute(routeHash(pair)), pair);
  assert.doesNotMatch(routeHash(pair), /power=|percent=/);
  assert.equal(readRoute(`#simulator?compare=${second}`).compareWith, "");
  assert.equal(
    readRoute(`#simulator?pool=${first}&compare=choose`).compareWith,
    "",
  );
  assert.equal(readRoute(`#markets?compare=${second}`).compareWith, "");
});
