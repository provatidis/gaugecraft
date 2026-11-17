import type { MarketRow, Maybe } from "../shared/types.js";
import { isFresh } from "./freshness.js";
import { comparableFeeWindow } from "./coverage.js";
import { finite } from "./math.js";

export type EarningsBasis = "history" | "baseline" | "partial" | "unavailable";
export interface EarningsComparison {
  basis: EarningsBasis;
  earnings: Maybe;
  stress: Maybe;
  returningStress?: Maybe;
  stressUsesMedian?: boolean;
  fees: Maybe;
  incentives: Maybe;
  reason: string;
}
export const EVIDENCE_LABELS: Record<EarningsBasis, string> = {
  history: "History-based estimate",
  baseline: "Baseline · limited history",
  partial: "Partial fee window",
  unavailable: "Unavailable",
};

// The observed median includes all stakes. Assume the user's existing power was
// present in that history and remove it once before adding their intended power.
export function returningCompetition(
  projectedOther: number,
  medianAllocation: Maybe | undefined,
  existingPower = 0,
) {
  if (
    medianAllocation == null ||
    !Number.isFinite(medianAllocation) ||
    medianAllocation < 0
  )
    return null;
  return Math.max(projectedOther * 1.5, medianAllocation - existingPower);
}

// An immediate, constant-power comparison at the forecast cutoff. Forecast records
// remain immutable; personal inputs are used only by the client and are never saved there.
export function allocationEarnings(
  row: MarketRow,
  power: number,
  existingPower = 0,
  now = Date.now() / 1000,
): EarningsComparison {
  const { snapshot: s, forecast: f } = row;
  const blocked = (
    basis: EarningsBasis,
    reason: string,
  ): EarningsComparison => ({
    basis,
    earnings: null,
    stress: null,
    returningStress: null,
    fees: null,
    incentives: null,
    reason,
  });
  if (!s.active) return blocked("unavailable", "Inactive pool");
  if (!isFresh(s, now)) return blocked("unavailable", "Stale observation");
  if (
    !Number.isFinite(power) ||
    power <= 0 ||
    !Number.isFinite(existingPower) ||
    existingPower < 0 ||
    (s.allocation !== null && existingPower > s.allocation)
  )
    return blocked(
      "unavailable",
      "Check intended and existing allocation power",
    );
  if (!comparableFeeWindow(s.windowEnd - s.windowStart))
    return blocked(
      "partial",
      "A comparable 48h earnings estimate needs a near-full 48h fee window; short windows are not extrapolated.",
    );
  const values = [
    s.eligibleFees48hUsd,
    s.allocation,
    f.projectedAllocation,
    f.projectedFees,
    f.projectedIncentives,
  ];
  if (values.some((v) => v === null || !Number.isFinite(v) || v < 0))
    return blocked(
      "unavailable",
      "Allocation, eligible fees or priced incentives are unavailable",
    );
  const current = s.allocation!;
  // Apply the forecast's proportional growth to other allocators, then add the
  // user's intended total exactly once. No projected outflow benefit is assumed.
  const growth =
    current > 0 ? Math.max(1, f.projectedAllocation! / current) : 1;
  const other = (current - existingPower) * growth;
  const returningOther = returningCompetition(
    other,
    f.basis === "history" ? f.medianAllocation48h : null,
    existingPower,
  );
  const share = power / (other + power);
  const fees = finite(share * f.projectedFees!);
  const incentives = finite(share * f.projectedIncentives!);
  const stressedEarnings = (competition: number) =>
    finite(
      (power / (competition + power)) *
        (f.projectedFees! * 0.5 + f.projectedIncentives!),
    );
  return {
    basis: f.basis === "history" ? "history" : "baseline",
    earnings: finite(share * (f.projectedFees! + f.projectedIncentives!)),
    stress: stressedEarnings(other * 1.5),
    returningStress:
      returningOther === null ? null : stressedEarnings(returningOther),
    stressUsesMedian: returningOther !== null && returningOther > other * 1.5,
    fees,
    incentives,
    reason:
      f.basis === "history"
        ? "Conservative fee and allocation forecasts; scheduled incentives stop at expiry."
        : "Current fees and competing allocation held constant; insufficient history to assess persistence.",
  };
}

// Evidence cohorts remain separate even for ascending sorts; nulls never rise to the top.
export function compareEarnings(
  a: EarningsComparison,
  b: EarningsComparison,
  metric: "earnings" | "stress" | "returningStress",
  descending = true,
) {
  const order: Record<EarningsBasis, number> = {
    history: 0,
    baseline: 1,
    partial: 2,
    unavailable: 3,
  };
  if (a.basis !== b.basis) return order[a.basis] - order[b.basis];
  const av = a[metric] ?? null,
    bv = b[metric] ?? null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return (av - bv) * (descending ? -1 : 1);
}
