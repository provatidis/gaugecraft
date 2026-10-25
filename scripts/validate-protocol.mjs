import process from "node:process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http, parseAbi } from "viem";

// Read-only audit. It never opens the collector database or inserts observations.
const chains = JSON.parse(await readFile("config/chains.json", "utf8"));
const sugar = parseAbi(
  JSON.parse(await readFile("config/sugar-abi.json", "utf8")),
);
const manager = parseAbi([
  "function totalSupply() view returns(uint256)",
  "function incentiveCount() view returns(uint256)",
  "function incentives(uint256[] ids) view returns(Program[])",
  "struct Program { address token; uint256 amount; uint256 rate; uint48 start; uint48 end; address creator; }",
]);
const voter = parseAbi(["function allocationCooldown() view returns(uint48)"]);
const response = await globalThis.fetch(
  "https://gaugecraft.sh/data/live/state.json",
  {
    signal: globalThis.AbortSignal.timeout(30000),
    cache: "no-store",
  },
);
if (!response.ok) throw new Error("Published observations unavailable");
const state = await response.json();
const pools = state.markets.map((r) => r.snapshot);
const chosen = [];
function take(
  label,
  predicate,
  sort = (a, b) => (b.rewards48hUsd ?? -1) - (a.rewards48hUsd ?? -1),
) {
  const s = pools
    .filter((s) => !chosen.some((c) => c.snapshot.id === s.id) && predicate(s))
    .sort(sort)[0];
  if (s) chosen.push({ label, snapshot: s });
}
take(
  "Base WETH/USDC",
  (s) =>
    s.chainId === 8453 &&
    [s.token0.symbol, s.token1.symbol].includes("WETH") &&
    [s.token0.symbol, s.token1.symbol].includes("USDC"),
);
take("Base Basic pool", (s) => s.chainId === 8453 && s.poolType === 0);
take(
  "Base scheduled incentives",
  (s) => s.chainId === 8453 && s.incentives48hUsd > 0,
  (a, b) => b.incentives48hUsd - a.incentives48hUsd,
);
take(
  "Base incentive expiration within 48h",
  (s) =>
    s.chainId === 8453 &&
    s.programs?.some(
      (p) => p.end > s.observedAt && p.end < s.observedAt + 172800,
    ),
);
if (chosen.length < 4)
  take(
    "Base missing USD fee estimate",
    (s) => s.chainId === 8453 && s.eligibleFees48hUsd === null,
  );
take(
  "OP missing Stake APR price",
  (s) => s.chainId === 10 && s.stakeApr === null,
);
while (chosen.length < 5) {
  const before = chosen.length;
  take("Additional Base pool", (s) => s.chainId === 8453);
  if (chosen.length === before) break;
}
const cases = [];
for (const { label, snapshot: s } of chosen) {
  console.log(`Validating ${label}: ${s.id}`);
  const config = chains.find((c) => c.id === s.chainId);
  const client = createPublicClient({
    transport: http(process.env[`RPC_${config.id}`] || config.rpc, {
      timeout: 15000,
      retryCount: 1,
    }),
  });
  const block = BigInt(s.block);
  let stage = "block identity";
  try {
    if ((await client.getChainId()) !== config.id)
      throw new Error("Wrong chain");
    const sourceBlock = await client.getBlock({ blockNumber: block });
    if (sourceBlock.hash.toLowerCase() !== s.blockHash.toLowerCase())
      throw new Error("Block hash differs");
    const read = async (address, abi, functionName, args = []) => {
      await delay(175);
      return client.readContract({
        address,
        abi,
        functionName,
        args,
        blockNumber: block,
      });
    };
    stage = "Sugar pool read";
    const raw = await read(config.sugar, sugar, "byAddress", [
      s.address,
      172800,
    ]);
    stage = "reward allocation and schedules";
    const supply = await read(s.rewardsManager, manager, "totalSupply");
    const count = Number(
      await read(s.rewardsManager, manager, "incentiveCount"),
    );
    if (count > 5000) throw new Error("Unexpected program count");
    const programs = [];
    for (let offset = 0; offset < count; offset += 50)
      programs.push(
        ...(await read(s.rewardsManager, manager, "incentives", [
          Array.from({ length: Math.min(50, count - offset) }, (_, i) =>
            BigInt(offset + i + 1),
          ),
        ])),
      );
    stage = "token metadata and cooldown";
    const addresses = [
      ...new Set([
        s.token0.address,
        s.token1.address,
        ...programs.map((p) => p.token.toLowerCase()),
      ]),
    ];
    const metadata = await read(config.sugar, sugar, "tokens", [
      BigInt(addresses.length),
      0n,
      0,
      addresses,
    ]);
    const tokens = new Map(
      metadata.map((t) => [t.tokenAddress.toLowerCase(), t]),
    );
    const cooldown =
      Number(await read(config.leafVoter, voter, "allocationCooldown")) / 3600;
    const usd = (amount, address) => {
      if (BigInt(amount) === 0n) return 0;
      const token = tokens.get(address.toLowerCase()),
        price = s.prices[address.toLowerCase()]?.usd;
      return token && price != null
        ? (Number(amount) / 10 ** Number(token.decimals)) * price
        : null;
    };
    const sum = (values) =>
      values.every((v) => v !== null && Number.isFinite(v))
        ? values.reduce((a, b) => a + b, 0)
        : null;
    const gross = sum([
      usd(raw.windowFee0, s.token0.address),
      usd(raw.windowFee1, s.token1.address),
    ]);
    const fraction =
      raw.liquidity > 0n
        ? Number(raw.gaugeLiquidity) / Number(raw.liquidity)
        : 0;
    const valid =
      Number(raw.windowStart) > 0 &&
      Number(raw.windowEnd) >= Number(raw.windowStart) &&
      Number(raw.windowEnd) <= Number(sourceBlock.timestamp) + 60;
    const fees =
      valid && gross !== null && fraction <= 1.000001 ? gross * fraction : null;
    const incentives = sum(
      programs.map((p) => {
        const seconds = Math.max(
          0,
          Math.min(Number(p.end), s.observedAt + 172800) -
            Math.max(Number(p.start), s.observedAt),
        );
        return usd((p.rate * BigInt(seconds)) / 10n ** 18n, p.token);
      }),
    );
    const rewards = sum([fees, incentives]);
    const allocation = Number(supply) / 1e18;
    const apr =
      rewards !== null &&
      s.aeroPriceUsd !== null &&
      allocation * s.aeroPriceUsd > 0
        ? (rewards / (allocation * s.aeroPriceUsd)) * 182.5 * 100
        : null;
    const checks = [];
    const check = (name, published, recalculated) =>
      checks.push({
        name,
        published,
        recalculated,
        match:
          typeof published === "number" && typeof recalculated === "number"
            ? Math.abs(published - recalculated) <=
              1e-8 * Math.max(1, Math.abs(published), Math.abs(recalculated))
            : JSON.stringify(published) === JSON.stringify(recalculated),
      });
    check("pool identity", s.address.toLowerCase(), raw.lp.toLowerCase());
    check(
      "reward manager",
      s.rewardsManager.toLowerCase(),
      raw.rewardsManager.toLowerCase(),
    );
    check("allocation power", s.allocation, allocation);
    check("source window start", s.windowStart, Number(raw.windowStart));
    check("source window end", s.windowEnd, Number(raw.windowEnd));
    check("cooldown hours", s.cooldownHours, cooldown);
    check("staked liquidity fraction", s.stakedFraction, fraction);
    check(
      "eligible fees USD using retained prices",
      s.eligibleFees48hUsd,
      fees,
    );
    check(
      "incentives USD using retained prices",
      s.incentives48hUsd,
      incentives,
    );
    check("pool rewards USD using retained prices", s.rewards48hUsd, rewards);
    check("Stake APR using retained AERO price", s.stakeApr, apr);
    const expected =
      s.programs?.map((p) => ({
        token: p.token.address.toLowerCase(),
        rate: p.rateRaw,
        start: p.start,
        end: p.end,
      })) ?? null;
    const actual = programs.map((p) => ({
      token: p.token.toLowerCase(),
      rate: p.rate.toString(),
      start: Number(p.start),
      end: Number(p.end),
    }));
    check("complete incentive schedules", expected, actual);
    cases.push({
      label,
      poolId: s.id,
      pair: `${s.token0.symbol}/${s.token1.symbol}`,
      chain: s.chain,
      block: s.block,
      blockHash: s.blockHash,
      observedAt: s.observedAt,
      retrievedAt: s.retrievedAt,
      status: checks.every((c) => c.match) ? "matched" : "discrepancy",
      checks,
      raw: {
        totalSupply: supply.toString(),
        liquidity: raw.liquidity.toString(),
        gaugeLiquidity: raw.gaugeLiquidity.toString(),
        windowFee0: raw.windowFee0.toString(),
        windowFee1: raw.windowFee1.toString(),
        programs: actual,
      },
      priceLimitation:
        "Uses retained Gaugecraft USD prices; this is not an independent price-oracle or official UI quote check.",
    });
  } catch {
    cases.push({
      label,
      poolId: s.id,
      block: s.block,
      blockHash: s.blockHash,
      status: "unavailable",
      stage,
      limitation:
        "Pinned-block public RPC validation could not complete; no comparison result is claimed.",
    });
  }
}
const report = {
  version: 1,
  verifiedAt: new Date().toISOString(),
  publishedAt: new Date(state.now * 1000).toISOString(),
  source: "https://gaugecraft.sh/data/live/state.json",
  method:
    "Independent contract reads pinned to each published snapshot block and hash; USD arithmetic recalculated with retained snapshot prices. No collector/database writes.",
  limitations: [
    "Five selected cases are a spot check, not a contract audit or exhaustive pool validation.",
    "No same-block official frontend USD quote was obtained; price differences with the Aero UI remain possible.",
  ],
  cases,
};
if (process.argv[2]) {
  await mkdir(dirname(process.argv[2]), { recursive: true });
  await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
}
console.log(
  JSON.stringify(
    {
      verifiedAt: report.verifiedAt,
      cases: cases.map((c) => ({
        label: c.label,
        poolId: c.poolId,
        status: c.status,
        stage: c.stage,
        failed: c.checks?.filter((k) => !k.match).map((k) => k.name),
      })),
    },
    null,
    2,
  ),
);
if (cases.some((c) => c.status !== "matched")) process.exitCode = 1;
