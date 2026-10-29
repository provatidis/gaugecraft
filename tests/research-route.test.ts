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
