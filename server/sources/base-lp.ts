import { parseAbi } from "viem";
import {
  pools,
  WEEK,
  type Point,
  type Pool,
  type Terms,
  type Quote,
  type Counter,
} from "../../src/analysis/liquidity.js";
import { chains, sugarAbi } from "./aero.js";
import { Rpc, type Read } from "./rpc.js";
const base = chains.find((c) => c.id === 8453)!;
const pricePool = "0xd0acf293547457fb4fe9ee32ca93e89497626816";
const assets = {
  WETH: "0x4200000000000000000000000000000000000006",
  cbBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
};
const abi = parseAbi([
  "function slot0() view returns(uint160,int24,uint16,uint16,uint16,bool)",
  "function feeGrowthGlobal0X128() view returns(uint256)",
  "function feeGrowthGlobal1X128() view returns(uint256)",
  "function rewardGrowthGlobalX128() view returns(uint256)",
  "function liquidity() view returns(uint128)",
  "function stakedLiquidity() view returns(uint128)",
  "function ticks(int24) view returns(uint128,int128,int128,uint256,uint256,uint256,int56,uint160,uint32,bool)",
  "function getFeeGrowthInside(int24,int24) view returns(uint256,uint256)",
  "function getRewardGrowthInside(int24,int24,uint256) view returns(uint256)",
  "function gaugeFactory() view returns(address)",
  "function referralConfig(address) view returns(address,uint256)",
  "function effectivePenaltyConfig(address) view returns(uint256,uint256)",
]);
const query = (
  address: string,
  functionName: string,
  args: readonly unknown[] = [],
): Read => ({ address, functionName, args, abi });
interface SugarPool {
  lp: string;
  token0: string;
  token1: string;
  poolType: number;
  emissionsToken: string;
  gauge: string;
  gaugeAlive: boolean;
  sqrtRatio: bigint;
  emissions: bigint;
  emissionsCap: bigint;
  liquidity: bigint;
  gaugeLiquidity: bigint;
  windowStart: number;
  windowEnd: number;
  windowFee0: bigint;
  windowFee1: bigint;
  unstakedFee: bigint;
}
export interface Block {
  block: number;
  at: number;
  hash: string;
}
export class BaseLpReader {
  calls = 0;
  contractReads = 0;
  rpc = new Rpc(process.env.RPC_8453 || base.rpc, 180, () => {
    this.calls++;
  });
  private async block(number: bigint | "latest"): Promise<Block> {
    const b = await this.rpc.retry(() =>
      this.rpc.client.getBlock(
        typeof number === "bigint"
          ? { blockNumber: number }
          : { blockTag: number },
      ),
    );
    return { at: Number(b.timestamp), block: Number(b.number), hash: b.hash };
  }
  async head() {
    if ((await this.rpc.retry(() => this.rpc.client.getChainId())) !== 8453)
      throw new Error("Unexpected LP chain");
    const latest = await this.block("latest");
    const head = await this.block(BigInt(latest.block - 20));
    if (Math.abs(Date.now() / 1000 - head.at) > 300)
      throw new Error("Base head stale");
    return head;
  }
  // Interpolate using measured block time and verify the returned timestamp at every checkpoint.
  async at(timestamp: number, anchor: Block, step: number) {
    if (Math.abs(anchor.at - timestamp) <= 2) return anchor;
    let low = 1,
      high = anchor.block,
      b = anchor,
      rate = step,
      closest = anchor;
    for (let i = 0; i < 34 && low <= high; i++) {
      const interpolated = b.block + Math.round((timestamp - b.at) / rate);
      const n =
        Number.isFinite(interpolated) &&
        interpolated >= low &&
        interpolated <= high &&
        i < 5
          ? interpolated
          : Math.floor((low + high) / 2);
      const next = await this.block(BigInt(n));
      if (Math.abs(next.at - timestamp) < Math.abs(closest.at - timestamp))
        closest = next;
      if (Math.abs(next.at - timestamp) <= 1) return next;
      if (next.at < timestamp) low = n + 1;
      else high = n - 1;
      if (next.block !== b.block && next.at !== b.at)
        rate = (next.at - b.at) / (next.block - b.block);
      b = next;
    }
    if (Math.abs(closest.at - timestamp) <= 60) return closest;
    throw new Error(
      "Base checkpoint has no block within one minute of " + timestamp,
    );
  }
  async batch(q: Read[], block: number) {
    this.contractReads += q.length;
    return this.rpc.batch(q, BigInt(block));
  }
  async point(b: Block): Promise<Point> {
    const fields = [
      "slot0",
      "feeGrowthGlobal0X128",
      "feeGrowthGlobal1X128",
      "rewardGrowthGlobalX128",
      "liquidity",
      "stakedLiquidity",
    ];
    const results = await this.batch(
      [
        ...pools.flatMap((p) => fields.map((f) => query(p.address, f))),
        query(pricePool, "slot0"),
      ],
      b.block,
    );
    const data: Point = { ...b, aeroUsd: null, samples: {} };
    const mark = results.at(-1) as [bigint, ...unknown[]] | null;
    if (mark && mark[0] > 0n)
      data.aeroUsd = (Number(mark[0]) / 2 ** 96) ** 2 * 1e12;
    pools.forEach((pool, i) => {
      const [slot, f0, f1, a, liquidity, staked] = results.slice(
        i * fields.length,
        (i + 1) * fields.length,
      );
      data.samples[pool.address] =
        Array.isArray(slot) &&
        slot[0] > 0n &&
        [f0, f1, a, liquidity, staked].every((x) => typeof x === "bigint")
          ? {
              tick: Number(slot[1]),
              sqrt: Number(slot[0]) / 2 ** 96,
              growth: [String(f0), String(f1), String(a)],
              liquidity: Number(liquidity),
              staked: Number(staked),
            }
          : null;
    });
    return data;
  }
  async week(end: Block) {
    const near = await this.block(BigInt(end.block - 3600));
    const rate = (end.at - near.at) / (end.block - near.block);
    if (!(rate > 0)) throw new Error("Invalid Base block interval");
    const series: Point[] = [];
    for (let i = 0; i <= 28; i++) {
      const b =
        i === 28 ? end : await this.at(end.at - WEEK + i * 21600, end, rate);
      series.push(await this.point(b));
    }
    return series;
  }
  async counters(
    rows: Quote[],
    point: Point,
  ): Promise<Record<string, Counter>> {
    const result = await this.batch(
      rows.flatMap((q) => [
        query(q.address, "ticks", [q.lower]),
        query(q.address, "ticks", [q.upper]),
        query(q.address, "getFeeGrowthInside", [q.lower, q.upper]),
        query(q.address, "getRewardGrowthInside", [q.lower, q.upper, 0n]),
      ]),
      point.block,
    );
    const out: Record<string, Counter> = {};
    rows.forEach((q, i) => {
      const [lo, hi, fees, aero] = result.slice(i * 4, i * 4 + 4);
      const sample = point.samples[q.address];
      if (
        !sample ||
        !Array.isArray(lo) ||
        !lo[9] ||
        !Array.isArray(hi) ||
        !hi[9] ||
        !Array.isArray(fees) ||
        typeof aero !== "bigint"
      )
        return;
      const above = (t: number, outside: number) =>
        sample.tick >= t ? point.at - outside : outside;
      out[q.address + "-" + q.width] = {
        above: [above(q.lower, lo[8]), above(q.upper, hi[8])],
        growth: [String(fees[0]), String(fees[1]), String(aero)],
      };
    });
    return out;
  }
  async terms(point: Point): Promise<Record<string, Terms>> {
    const meta = (await this.batch(
      [...pools.map((p) => p.address), pricePool].map((address) => ({
        address: base.sugar,
        abi: sugarAbi,
        functionName: "byAddress",
        args: [address, 172800],
      })),
      point.block,
    )) as (SugarPool | null)[];
    const mark = meta.at(-1);
    if (
      mark?.lp.toLowerCase() !== pricePool ||
      mark.token0.toLowerCase() !== base.aero ||
      mark.token1.toLowerCase() !== base.stable
    )
      point.aeroUsd = null;
    const terms: Record<string, Terms> = {};
    const valid: { pool: Pool; m: SugarPool }[] = [];
    pools.forEach((pool, i) => {
      const m = meta[i],
        eth = pool.asset === "WETH";
      if (
        !m ||
        m.lp.toLowerCase() !== pool.address ||
        m.poolType !== pool.spacing ||
        m.token0.toLowerCase() !== (eth ? assets.WETH : base.stable) ||
        m.token1.toLowerCase() !== (eth ? base.stable : assets.cbBTC)
      )
        return;
      valid.push({ pool, m });
      const sqrt = Number(m.sqrtRatio) / 2 ** 96,
        spot = eth ? sqrt ** 2 * 1e12 : 100 / sqrt ** 2;
      const usd0 = eth ? spot / 1e18 : 1e-6,
        usd1 = eth ? 1e-6 : spot / 1e8;
      const basis = ((pool.spacing === 50 ? 300 : 500) / 10000) * sqrt * usd1;
      const period = m.windowEnd - m.windowStart;
      const alive =
        m.gaugeAlive && m.emissionsToken.toLowerCase() === base.aero;
      const feeApr =
        period > 0 && Number(m.liquidity) * basis > 0
          ? (((Number(m.windowFee0) * usd0 + Number(m.windowFee1) * usd1) *
              (1 - Number(m.unstakedFee) / 1e6) *
              31536000) /
              period /
              (Number(m.liquidity) * basis)) *
            100
          : null;
      const aeroApr =
        alive && point.aeroUsd !== null && Number(m.gaugeLiquidity) * basis > 0
          ? (((Number(m.emissions) / 1e18) * point.aeroUsd * 31536000) /
              (Number(m.gaugeLiquidity) * basis)) *
            100
          : null;
      terms[pool.address] = {
        feeApr,
        aeroApr,
        alive,
        paying: alive && m.emissions > 0n && m.emissionsCap > 0n,
        referral: null,
        penalty: null,
        minBlocks: null,
      };
    });
    const factories = await this.batch(
      valid.map(({ m }) => query(m.gauge, "gaugeFactory")),
      point.block,
    );
    const gauges = valid.flatMap(({ pool, m }, i) =>
      typeof factories[i] === "string"
        ? [{ pool, gauge: m.gauge, factory: factories[i] as string }]
        : [],
    );
    const configs = await this.batch(
      gauges.flatMap(({ factory, gauge }) => [
        query(factory, "referralConfig", [gauge]),
        query(factory, "effectivePenaltyConfig", [gauge]),
      ]),
      point.block,
    );
    for (const [i, { pool }] of gauges.entries()) {
      const [ref, pen] = configs.slice(2 * i, 2 * i + 2);
      if (Array.isArray(ref) && Array.isArray(pen)) {
        Object.assign(terms[pool.address], {
          referral: BigInt(ref[0]) === 0n ? 0 : Number(ref[1]) / 1e6,
          minBlocks: Number(pen[0]),
          penalty: Number(pen[1]) / 1e6,
        });
      }
    }
    return terms;
  }
}
