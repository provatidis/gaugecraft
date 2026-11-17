// Dollar values in a quote are per $1 of starting portfolio, before execution costs.
export const DAY = 86400;
export const WEEK = 7 * DAY;
export const presets = {
  daily: [4, 8],
  weekly: [8, 16],
  occasional: [16, 32],
} as const;
export type Frequency = keyof typeof presets;
export type PairName = "WETH" | "cbBTC";
export type Reward = "fees" | "aero";
export type Strategy = Reward | "hold";
export interface Pool {
  address: string;
  asset: PairName;
  spacing: number;
}
export const pools: Pool[] = [
  {
    asset: "WETH",
    spacing: 50,
    address: "0x4a7af46bc8abc00048c6c7920a1488daf568366c",
  },
  {
    asset: "WETH",
    spacing: 100,
    address: "0x2a430bebd2082d8e05d56d64dede8944279bbc24",
  },
  {
    asset: "cbBTC",
    spacing: 50,
    address: "0x42609aa1e58c5dd7e5a012dc74118fff975f0eac",
  },
  {
    asset: "cbBTC",
    spacing: 100,
    address: "0x784e539f15ca2d19449a6311c5dab6cf37d8f1ba",
  },
];
export interface Sample {
  tick: number;
  sqrt: number; // raw token1/token0 square-root price
  growth: [string, string, string]; // exact Q128 fee0, fee1 and settled AERO per liquidity
  liquidity: number;
  staked: number;
}
export interface Point {
  at: number;
  block: number;
  hash: string;
  aeroUsd: number | null;
  samples: Record<string, Sample | null>;
}
export interface Counter {
  above: [number, number];
  growth: [string, string, string];
}
export interface Terms {
  feeApr: number | null;
  aeroApr: number | null;
  referral: number | null;
  penalty: number | null;
  minBlocks: number | null;
  alive: boolean;
  paying: boolean;
}
export interface Quote {
  address: string;
  asset: PairName;
  spacing: number;
  width: number;
  lower: number;
  upper: number;
  lowUsd: number;
  highUsd: number;
  spot: number;
  endSpot: number;
  units: number;
  stable: number;
  principal: number;
  hold: number;
  fees: number | null;
  aero: number | null;
  aeroTokens: number | null;
  aeroIssue: string | null;
  inRange: number;
  feeLimit: number;
  aeroLimit: number;
  feeApr: number | null;
  aeroApr: number | null;
}
export const defaultCosts = { gas: 1, bps: 10 };
export function costs(size: number) {
  return defaultCosts.gas + (size * defaultCosts.bps) / 10000;
}
export function position(sqrt: number, lower: number, upper: number) {
  const lo = 1.0001 ** (lower / 2),
    hi = 1.0001 ** (upper / 2);
  const clamp = Math.min(hi, Math.max(lo, sqrt));
  return [(hi - clamp) / (clamp * hi), clamp - lo] as const;
}
export function unitValues(pool: Pool, sqrt: number) {
  const eth = pool.asset === "WETH";
  const spot = eth ? sqrt * sqrt * 1e12 : 100 / (sqrt * sqrt);
  return { spot, v0: eth ? spot / 1e18 : 1e-6, v1: eth ? 1e-6 : spot / 1e8 };
}
export function bounds(tick: number, spacing: number, width: number) {
  const half = Math.log1p(width / 100) / Math.log(1.0001);
  return [
    Math.floor((tick - half) / spacing) * spacing,
    Math.ceil((tick + half) / spacing) * spacing,
  ] as const;
}
// Fraction of an interval inside the range if log price travels linearly between observations.
export function exposure(a: number, b: number, low: number, high: number) {
  if (a === b) return Number(a >= low && a < high);
  return (
    Math.max(
      0,
      Math.min(Math.max(a, b), high) - Math.max(Math.min(a, b), low),
    ) / Math.abs(b - a)
  );
}
export function quote(
  pool: Pool,
  width: number,
  opening: Point,
  series: Point[],
  terms: Terms,
  replay: boolean,
  inside?: [Counter, Counter],
  fixed?: Pick<Quote, "lower" | "upper">,
): Quote | null {
  const start = opening.samples[pool.address],
    first = series[0],
    last = series.at(-1);
  const from = first?.samples[pool.address],
    to = last?.samples[pool.address];
  if (
    !start ||
    !from ||
    !last ||
    !to ||
    series.length !== 29 ||
    Math.abs(last.at - first.at - WEEK) > 120
  )
    return null;
  const tick = (sqrt: number) => (2 * Math.log(sqrt)) / Math.log(1.0001);
  const [lower, upper] = fixed
    ? [fixed.lower, fixed.upper]
    : bounds(tick(start.sqrt), pool.spacing, width);
  const shift = replay ? start.sqrt / from.sqrt : 1;
  const endSqrt = to.sqrt * shift;
  const begin = unitValues(pool, start.sqrt),
    end = unitValues(pool, endSqrt);
  const [raw0, raw1] = position(start.sqrt, lower, upper);
  const L = 1 / (raw0 * begin.v0 + raw1 * begin.v1);
  const [out0, out1] = position(endSqrt, lower, upper);
  const totals = [0, 0, 0];
  let time = 0;
  for (let i = 1; i < series.length; i++) {
    const before = series[i - 1].samples[pool.address],
      after = series[i].samples[pool.address];
    const dt = series[i].at - series[i - 1].at;
    if (!before || !after || Math.abs(dt - 21600) > 120) return null;
    const fraction = exposure(
      tick(before.sqrt * shift),
      tick(after.sqrt * shift),
      lower,
      upper,
    );
    time += dt * fraction;
    for (let j = 0; j < 3; j++) {
      const delta = BigInt(after.growth[j]) - BigInt(before.growth[j]);
      if (delta < 0n) return null;
      totals[j] += (Number(delta) / 2 ** 128) * L * fraction;
    }
  }
  if (inside && stableCounters(inside, first, last, pool.address)) {
    for (let j = 0; j < 3; j++)
      totals[j] =
        (Number(BigInt(inside[1].growth[j]) - BigInt(inside[0].growth[j])) /
          2 ** 128) *
        L;
  }
  const isEth = pool.asset === "WETH";
  const prices = [
    unitValues(pool, 1.0001 ** (lower / 2)).spot,
    unitValues(pool, 1.0001 ** (upper / 2)).spot,
  ];
  const blocks = last.block - first.block;
  const rewardShare =
    (!replay || terms.paying) &&
    terms.alive &&
    terms.referral !== null &&
    terms.penalty !== null &&
    terms.minBlocks !== null
      ? (1 - terms.referral) *
        (blocks < terms.minBlocks ? 1 - terms.penalty : 1)
      : null;
  const aeroTokens =
    rewardShare === null ? null : (totals[2] / 1e18) * rewardShare;
  const rewardPrice = replay ? opening.aeroUsd : last.aeroUsd;
  return {
    address: pool.address,
    asset: pool.asset,
    spacing: pool.spacing,
    width,
    lower,
    upper,
    lowUsd: Math.min(...prices),
    highUsd: Math.max(...prices),
    spot: begin.spot,
    endSpot: end.spot,
    units: isEth ? (L * raw0) / 1e18 : (L * raw1) / 1e8,
    stable: isEth ? (L * raw1) / 1e6 : (L * raw0) / 1e6,
    principal: L * (out0 * end.v0 + out1 * end.v1),
    hold: L * (raw0 * end.v0 + raw1 * end.v1),
    fees: totals[0] * end.v0 + totals[1] * end.v1,
    aero:
      aeroTokens !== null && rewardPrice !== null
        ? aeroTokens * rewardPrice
        : null,
    aeroTokens,
    aeroIssue:
      replay && !terms.paying
        ? "No active AERO emissions at the decision block"
        : aeroTokens === null
          ? "Gauge reward terms unavailable"
          : rewardPrice === null
            ? "AERO price unavailable"
            : null,
    inRange: time / (last.at - first.at),
    feeLimit: (start.liquidity * 0.01) / L,
    aeroLimit: (start.staked * 0.01) / L,
    feeApr: terms.feeApr,
    aeroApr: terms.aeroApr,
  };
}
// On initialization the clock above a tick starts at zero. An older above-clock
// at the end proves the boundary survived the whole interval across crossings.
export function stableCounters(
  [a, b]: [Counter, Counter],
  start: Point,
  end: Point,
  address: string,
) {
  const dt = end.at - start.at,
    from = start.samples[address],
    to = end.samples[address];
  return (
    !!from &&
    !!to &&
    b.above.every(
      (v, i) => v > dt && v >= a.above[i] && v - a.above[i] <= dt,
    ) &&
    b.growth.every((v, i) => {
      const delta = BigInt(v) - BigInt(a.growth[i]);
      return (
        delta >= 0n && delta <= BigInt(to.growth[i]) - BigInt(from.growth[i])
      );
    })
  );
}
export function value(q: Quote, mode: Reward, size: number) {
  const income = q[mode],
    limit = mode === "fees" ? q.feeLimit : q.aeroLimit;
  if (!Number.isFinite(size) || size <= 0 || size > limit || income === null)
    return null;
  return (q.principal + income) * size - costs(size);
}
export interface Choice {
  address: string;
  width: number;
  mode: Strategy;
}
export function choices(
  quotes: Quote[],
  asset: PairName,
  preset: Frequency,
  size: number,
) {
  const widths: readonly number[] = presets[preset];
  const list = quotes.filter(
    (q) => q.asset === asset && widths.includes(q.width),
  );
  const options = list
    .flatMap((q) =>
      (["fees", "aero"] as const).flatMap((mode) => {
        const net = value(q, mode, size);
        return net === null
          ? []
          : [{ q, mode, net, edge: net - size * q.hold }];
      }),
    )
    .sort((a, b) => b.edge - a.edge || a.q.address.localeCompare(b.q.address));
  const best = options[0];
  const pick: Choice | null = best
    ? {
        address: best.q.address,
        width: best.q.width,
        mode: best.edge > 0 ? best.mode : "hold",
      }
    : null;
  const aprOptions = list
    .filter((q) => q.width === widths[0])
    .flatMap((q) =>
      (["fees", "aero"] as const).map((mode) => ({
        q,
        mode,
        apr: mode === "fees" ? q.feeApr : q.aeroApr,
      })),
    );
  const displayed = (n: number | null) =>
    n === null
      ? -1
      : Number(Math.min(9000, n).toFixed(n < 1 ? 2 : n < 100 ? 1 : 0));
  const ranked = aprOptions.sort(
    (a, b) =>
      displayed(b.apr) - displayed(a.apr) ||
      a.q.address.localeCompare(b.q.address) ||
      a.mode.localeCompare(b.mode),
  );
  const lead = ranked[0];
  const headline: Choice | null =
    lead && ranked.length === 4 && ranked.every((x) => x.apr !== null)
      ? { address: lead.q.address, width: lead.q.width, mode: lead.mode }
      : null;
  return { best, options, pick, headline };
}
export interface Score {
  pickEvidence: string;
  headlineEvidence: string;
  pickEdge: number | null;
  headlineEdge: number | null;
  pickNet: number | null;
  headlineNet: number | null;
  hold: number | null;
}
export interface Entry {
  asset: PairName;
  preset: Frequency;
  pick: Choice | null;
  headline: Choice | null;
  score?: Score;
}
export interface Decision {
  at: number;
  block: number;
  hash: string;
  published: number;
  quotes: Quote[];
  entries: Entry[];
  scoredAt?: number;
  outcomeBlock?: number;
}
export interface PilotView {
  started: number | null;
  latest: Decision | null;
  history: Omit<Decision, "quotes">[];
  restoredAt: number | null;
}
