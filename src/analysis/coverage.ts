import type {
  HistoryPoint,
  PersistenceCoverage,
  Snapshot,
} from "../shared/types.js";
import { HORIZON, HOUR } from "./math.js";

export const PERSISTENCE_REQUIREMENTS = {
  minSpanSeconds: 47.5 * HOUR,
  minObservations: 80,
  maxGapSeconds: 75 * 60,
  minPricedFees: 80,
  minFeeWindowSeconds: 47 * HOUR,
  maxFeeWindowSeconds: 49 * HOUR,
} as const;

export function comparableFeeWindow(seconds: number) {
  return (
    seconds >= PERSISTENCE_REQUIREMENTS.minFeeWindowSeconds &&
    seconds <= PERSISTENCE_REQUIREMENTS.maxFeeWindowSeconds
  );
}

export function historyCoverage<T extends Pick<HistoryPoint, "observedAt">>(
  rows: T[],
  end: number,
) {
  const samples = rows
    .filter((s) => s.observedAt <= end && s.observedAt >= end - HORIZON)
    .sort((a, b) => a.observedAt - b.observedAt);
  const span = samples.length ? (end - samples[0].observedAt) / HOUR : 0;
  const maxGap = samples
    .slice(1)
    .reduce((m, s, i) => Math.max(m, s.observedAt - samples[i].observedAt), 0);
  return {
    samples,
    span,
    maxGap,
    ready:
      span * HOUR >= PERSISTENCE_REQUIREMENTS.minSpanSeconds &&
      samples.length >= PERSISTENCE_REQUIREMENTS.minObservations &&
      maxGap <= PERSISTENCE_REQUIREMENTS.maxGapSeconds,
  };
}

export function persistenceCoverage(
  snapshot: Snapshot,
  history: Snapshot[],
): PersistenceCoverage {
  const availableAt = Math.max(snapshot.observedAt, snapshot.retrievedAt);
  const { samples, span, maxGap, ready } = historyCoverage(
    history.filter(
      (s) =>
        s.id === snapshot.id &&
        s.mode === snapshot.mode &&
        s.retrievedAt <= availableAt,
    ),
    snapshot.observedAt,
  );
  const pricedFeeCount = samples.filter(
    (s) => s.eligibleFees48hUsd !== null,
  ).length;
  const supply = allocationCoverage(samples, snapshot.observedAt);
  const sourceWindowSeconds = snapshot.windowEnd - snapshot.windowStart;
  return {
    availableAt,
    windowStart: snapshot.observedAt - HORIZON,
    windowEnd: snapshot.observedAt,
    firstObservation: samples[0]?.observedAt ?? null,
    lastObservation: samples.at(-1)?.observedAt ?? null,
    sampleCount: samples.length,
    spanSeconds: span * HOUR,
    maxGapSeconds: samples.length >= 2 ? maxGap : null,
    pricedFeeCount,
    allocationCoverage: { count: supply.values.length, ready: supply.ready },
    sourceWindowSeconds,
    gaps: samples.slice(1).flatMap((s, i) => {
      const start = samples[i].observedAt;
      const seconds = s.observedAt - start;
      return seconds > PERSISTENCE_REQUIREMENTS.maxGapSeconds
        ? [{ start, end: s.observedAt, seconds }]
        : [];
    }),
    ready:
      ready &&
      pricedFeeCount >= PERSISTENCE_REQUIREMENTS.minPricedFees &&
      comparableFeeWindow(sourceWindowSeconds),
  };
}

// Missing supply between genuine observations must not establish a 48h median.
export function allocationCoverage(samples: Snapshot[], end: number) {
  const { samples: known, ready } = historyCoverage(
    samples.filter(
      (s) =>
        s.allocation !== null &&
        Number.isFinite(s.allocation) &&
        s.allocation >= 0,
    ),
    end,
  );
  const span = known.length
    ? known.at(-1)!.observedAt - known[0].observedAt
    : 0;
  return {
    values: known.map((s) => s.allocation!),
    ready: ready && span >= PERSISTENCE_REQUIREMENTS.minSpanSeconds,
  };
}
