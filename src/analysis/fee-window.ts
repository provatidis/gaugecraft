import type {
  Evaluation,
  FeeTapePoint,
  Forecast,
  Snapshot,
} from "../shared/types.js";
import { finite, sumKnown, units } from "./math.js";

// Use the same endpoint tolerance as the original outcomes. Independent
// counter reads have a tighter limit at both ends of the holding period.
export function alignedFeeWindow(s: Snapshot, madeAt: number, dueAt: number) {
  return (
    Math.abs(s.windowStart - madeAt) <= 45 * 60 &&
    Math.abs(s.windowEnd - dueAt) <= 45 * 60
  );
}
export const FEE_TAPE_BOUNDARY_SECONDS = 180;
const UINT120_LIMIT = 1n << 120n;

function sameInstrument(a: Snapshot, b: Snapshot) {
  return (
    a.id === b.id &&
    a.mode === b.mode &&
    a.gauge === b.gauge &&
    a.rewardsManager === b.rewardsManager &&
    a.token0.address === b.token0.address &&
    a.token1.address === b.token1.address &&
    a.token0.decimals === b.token0.decimals &&
    a.token1.decimals === b.token1.decimals
  );
}

export function feeTapeBounds(f: Forecast, history: Snapshot[]) {
  const start = f.input;
  if (
    f.mode !== "live" ||
    start.mode !== f.mode ||
    start.id !== f.poolId ||
    start.observedAt > f.madeAt ||
    f.madeAt - start.observedAt > FEE_TAPE_BOUNDARY_SECONDS
  )
    return null;
  const end = history.findLast(
    (s) =>
      s.mode === f.mode &&
      s.id === f.poolId &&
      s.observedAt <= f.dueAt &&
      f.dueAt - s.observedAt <= FEE_TAPE_BOUNDARY_SECONDS,
  );
  if (
    !end ||
    start.observedAt >= end.observedAt ||
    end.blockHash === start.blockHash ||
    !sameInstrument(start, end)
  )
    return null;
  return { start, end };
}

export type FeeTapeLookup = (s: Snapshot) => FeeTapePoint | null;

export function tapeEligibleFees(
  f: Forecast,
  history: Snapshot[],
  endpoint: Snapshot,
  lookup: FeeTapeLookup,
) {
  const bounds = feeTapeBounds(f, history);
  if (!bounds) return null;
  const { start, end } = bounds;
  if (
    !sameInstrument(end, endpoint) ||
    history.some((s) => !sameInstrument(s, start))
  )
    return null;
  const a = lookup(start),
    b = lookup(end);
  if (
    !a ||
    !b ||
    a.tape !== b.tape ||
    a.blockHash !== start.blockHash ||
    b.blockHash !== end.blockHash ||
    a.lastSwapAt <= 0 ||
    a.lastSwapAt > start.observedAt ||
    b.lastSwapAt < a.lastSwapAt ||
    b.lastSwapAt > end.observedAt
  )
    return null;
  const fraction = endpoint.stakedFraction;
  if (
    fraction === null ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1.000001
  )
    return null;
  // Price token deltas exactly as the original gross-fee proxy does. Subtract
  // integers before conversion and never turn a missing mark into zero.
  const counters = [a.fee0, a.fee1, b.fee0, b.fee1];
  if (!counters.every((n) => /^\d{1,37}$/.test(n) && BigInt(n) < UINT120_LIMIT))
    return null;
  const delta0 = BigInt(b.fee0) - BigInt(a.fee0),
    delta1 = BigInt(b.fee1) - BigInt(a.fee1);
  if (
    delta0 < 0n ||
    delta1 < 0n ||
    (a.lastSwapAt === b.lastSwapAt && (delta0 !== 0n || delta1 !== 0n))
  )
    return null;
  function amount(delta: bigint, token: Snapshot["token0"]) {
    if (delta === 0n) return 0;
    const price = endpoint.prices[token.address]?.usd;
    if (
      !(price > 0) ||
      !Number.isFinite(price) ||
      !Number.isInteger(token.decimals) ||
      token.decimals < 0 ||
      token.decimals > 36
    )
      return null;
    return finite(units(delta, token.decimals) * price);
  }
  const gross = sumKnown([
    amount(delta0, end.token0),
    amount(delta1, end.token1),
  ]);
  if (gross === null) return null;
  const eligible = finite(gross * fraction);
  if (eligible === null) return null;
  const evidence: NonNullable<Evaluation["feeWindowEvidence"]> = {
    tape: a.tape,
    startAt: start.observedAt,
    endAt: end.observedAt,
    startBlock: start.block,
    endBlock: end.block,
    startHash: start.blockHash,
    endHash: end.blockHash,
    fee0Raw: delta0.toString(),
    fee1Raw: delta1.toString(),
  };
  return { eligible, evidence };
}
