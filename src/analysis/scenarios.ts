import type { MarketRow } from "../shared/types.js";
import { allocationEarnings } from "./earnings.js";
import {
  annualized,
  finite,
  simulate,
  SCENARIOS,
  type Scenario,
  type SimulationInput,
} from "./math.js";

export type ScenarioBasis = "forecast" | "stress" | "current";
export const SCENARIO_LABELS: Record<ScenarioBasis, string> = {
  forecast: "Markets estimate",
  stress: "Markets stress",
  current: "Current competition",
};

// Personal scenarios reuse the comparison cutoff and evidence gates without
// modifying any frozen forecast. Extra shocks apply to the selected starting case.
export function simulateAllocation(
  row: MarketRow,
  input: SimulationInput,
  basis: ScenarioBasis,
  shock: Scenario = SCENARIOS[0],
  now = Date.now() / 1000,
) {
  const comparison = allocationEarnings(
    row,
    input.power,
    input.existingPower,
    now,
  );
  if (comparison.earnings === null)
    return { earnings: null, apr: null, share: null, error: comparison.reason };
  const { snapshot, forecast } = row;
  const growth =
    basis === "current" || snapshot.allocation === 0
      ? 1
      : Math.max(1, forecast.projectedAllocation! / snapshot.allocation!);
  const other = (snapshot.allocation! - input.existingPower) * growth;
  const competition = (basis === "stress" ? 1.5 : 1) * (1 + shock.competition);
  const fees = forecast.projectedFees! * (basis === "stress" ? 0.5 : 1);
  const result = simulate(
    {
      ...snapshot,
      observedAt: forecast.madeAt,
      allocation: other + input.existingPower,
    },
    fees,
    input,
    { ...shock, competition: competition - 1 },
  );
  if (
    result.error ||
    input.activationDelayHours !== 0 ||
    input.remainingDays !== null
  )
    return result;
  // With constant power, use the full scheduled incentive total once, avoiding
  // per-segment token rounding and matching Markets exactly.
  const share = input.power / (other * competition + input.power);
  const earnings = finite(
    share * (fees + forecast.projectedIncentives!) * shock.revenueFactor,
  );
  return {
    earnings,
    apr: annualized(earnings, input.stakeValueUsd),
    share,
    error: null,
  };
}
