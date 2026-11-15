import type { MarketRow } from "../shared/types.js";
import { sumKnown, type SimulationInput } from "./math.js";
import { simulateAllocation, type ScenarioBasis } from "./scenarios.js";

export function splitCompatibilityError(first: MarketRow, second: MarketRow) {
  if (
    first.snapshot.id === second.snapshot.id ||
    first.snapshot.chainId !== second.snapshot.chainId ||
    first.snapshot.mode !== second.snapshot.mode
  )
    return "Choose two different pools on the same network and data source.";
  if (
    first.forecast.madeAt !== second.forecast.madeAt ||
    first.forecast.dueAt !== second.forecast.dueAt
  )
    return "These forecasts cover different periods. Choose another pool or refresh after collection.";
  return null;
}

export function simulateSplit(
  first: MarketRow,
  second: MarketRow,
  firstPercent: number,
  input: SimulationInput,
  secondExistingPower: number,
  basis: ScenarioBasis,
  now: number,
) {
  const error = splitCompatibilityError(first, second);
  if (error) return { error } as const;
  if (
    !Number.isFinite(firstPercent) ||
    firstPercent <= 0 ||
    firstPercent >= 100
  )
    return {
      error: "Choose a split that assigns power to both pools.",
    } as const;

  const firstPower = input.power * (firstPercent / 100);
  const secondPower = input.power - firstPower;
  const secondInput = { ...input, existingPower: secondExistingPower };
  const firstOnly = simulateAllocation(first, input, basis, undefined, now);
  const secondOnly = simulateAllocation(
    second,
    secondInput,
    basis,
    undefined,
    now,
  );
  const firstLeg = simulateAllocation(
    first,
    { ...input, power: firstPower },
    basis,
    undefined,
    now,
  );
  const secondLeg = simulateAllocation(
    second,
    { ...secondInput, power: secondPower },
    basis,
    undefined,
    now,
  );

  const total = sumKnown([firstLeg.earnings, secondLeg.earnings]);
  const advantage =
    total === null ||
    firstOnly.earnings === null ||
    secondOnly.earnings === null
      ? null
      : total - Math.max(firstOnly.earnings, secondOnly.earnings);

  return {
    error: null,
    firstOnly,
    secondOnly,
    firstLeg,
    secondLeg,
    firstPower,
    secondPower,
    total,
    advantage,
  } as const;
}
