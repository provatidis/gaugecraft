import React, { useEffect, useState } from "react";
import {
  comparableFeeWindow,
  PERSISTENCE_REQUIREMENTS as limits,
} from "../analysis/coverage.js";
import type {
  MarketRow,
  PersistenceCoverage,
  Snapshot,
} from "../shared/types.js";
import { get, hosted } from "./data.js";

const duration = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  const value =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${minutes}m`;
  return remainder && whole < 2 * 3600 ? `${value} ${remainder}s` : value;
};
const utc = (at: number) =>
  new Date(at * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";

export function PoolCoverage({ row }: { row: MarketRow }) {
  if (row.coverage || hosted) return <Coverage coverage={row.coverage} />;
  const s = row.snapshot;
  return (
    <LoadCoverage
      key={`${s.mode}:${s.id}:${s.observedAt}:${s.retrievedAt}:${s.blockHash}`}
      snapshot={s}
    />
  );
}

function LoadCoverage({ snapshot }: { snapshot: Snapshot }) {
  const [coverage, setCoverage] = useState<PersistenceCoverage>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { mode, id, observedAt, retrievedAt } = snapshot;
  useEffect(() => {
    const abort = new AbortController();
    get<PersistenceCoverage>(
      `/api/coverage?mode=${mode}&pool=${encodeURIComponent(id)}&at=${observedAt}`,
      abort.signal,
    )
      .then((result) => {
        if (
          result.windowEnd !== observedAt ||
          result.availableAt !== Math.max(observedAt, retrievedAt)
        )
          throw new Error("Coverage observation changed");
        if (!abort.signal.aborted) setCoverage(result);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [mode, id, observedAt, retrievedAt, attempt]);
  if (coverage) return <Coverage coverage={coverage} />;
  return (
    <section className="panel coverage-panel" aria-busy={!failed}>
      <h2>Forecast readiness</h2>
      <p role="status">
        {failed
          ? "Coverage diagnostics could not be loaded for this observation."
          : "Loading this pool’s 48-hour coverage…"}
      </p>
      {failed && (
        <button
          className="button"
          onClick={() => {
            setFailed(false);
            setAttempt(attempt + 1);
          }}
        >
          Retry coverage
        </button>
      )}
    </section>
  );
}

export function Coverage({ coverage }: { coverage?: PersistenceCoverage }) {
  if (!coverage)
    return (
      <section className="panel coverage-panel">
        <h2>Forecast readiness</h2>
        <p>Coverage diagnostics are unavailable for this published snapshot.</p>
      </section>
    );
  const checks = [
    {
      label: "Observations",
      value: `${coverage.sampleCount} / ${limits.minObservations}`,
      passed: coverage.sampleCount >= limits.minObservations,
      help: "Genuine observations available in this pool’s rolling 48-hour window, using the forecast’s original data cutoff.",
    },
    {
      label: "Observed span",
      value: duration(coverage.spanSeconds),
      requirement: `At least ${duration(limits.minSpanSeconds)}`,
      passed: coverage.spanSeconds >= limits.minSpanSeconds,
      help: "Time from the earliest retained observation in the window to the latest source block. A long span alone does not establish regular collection.",
    },
    {
      label: "Largest observed gap",
      value:
        coverage.maxGapSeconds === null
          ? "—"
          : duration(coverage.maxGapSeconds),
      requirement: `At most ${duration(limits.maxGapSeconds)}`,
      passed:
        coverage.maxGapSeconds !== null &&
        coverage.maxGapSeconds <= limits.maxGapSeconds,
      help: "Largest interval between adjacent source-block observations. The check needs at least two observations; missing periods are not backfilled.",
    },
    {
      label: "Priced fee observations",
      value: `${coverage.pricedFeeCount} / ${limits.minPricedFees}`,
      passed: coverage.pricedFeeCount >= limits.minPricedFees,
      help: "Observations with a known USD eligible-fee estimate. An observed zero counts; an unavailable price does not.",
    },
    {
      label: "Latest source fee window",
      value: duration(coverage.sourceWindowSeconds),
      requirement: `${duration(limits.minFeeWindowSeconds)} to ${duration(limits.maxFeeWindowSeconds)}`,
      passed: comparableFeeWindow(coverage.sourceWindowSeconds),
      help: "Actual duration returned by the protocol for the latest fee observation. Short launch windows are not scaled up to 48 hours.",
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  const largest = [...coverage.gaps]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);
  return (
    <section
      className="panel coverage-panel"
      aria-labelledby="coverage-heading"
    >
      <div className="coverage-heading">
        <div>
          <h2 id="coverage-heading">Forecast readiness</h2>
          <p>Rolling 48 hours ending {utc(coverage.windowEnd)}</p>
        </div>
        <span className={`badge ${coverage.ready ? "good" : "warn"}`}>
          {coverage.ready ? "History gate passed" : "Insufficient history"}
        </span>
      </div>
      <div className="coverage-checks">
        {checks.map((check) => (
          <div
            className={`coverage-check ${check.passed ? "passed" : "pending"}`}
            key={check.label}
            title={check.help}
          >
            <span>
              {check.label}
              {"\u00a0"}
              <span className="info" aria-label={check.help}>
                ⓘ
              </span>
            </span>
            <strong>{check.value}</strong>
            <small>
              {check.requirement ?? `At least ${limits.minObservations} in 48h`}
            </small>
            <span className="coverage-check-status">
              {check.passed ? "✓ Met" : "Needs data"}
            </span>
          </div>
        ))}
      </div>
      <p className="coverage-explanation">
        {failed.length
          ? `Blocked by: ${failed.map((check) => check.label.toLowerCase()).join(", ")}.`
          : "All history checks pass. Forecast estimates also require current, complete reward inputs."}{" "}
        These checks always use 48 hours, independently of the chart range. They
        describe data coverage, not predictive accuracy.
      </p>
      {coverage.allocationCoverage && (
        <p className="coverage-explanation">
          Returning competition needs 80 voting power observations across at
          least 47h 30m with gaps of at most 75 minutes.{" "}
          {coverage.allocationCoverage.count} observed.{" "}
          {coverage.allocationCoverage.ready
            ? "Voting power coverage is sufficient."
            : "Voting power coverage is incomplete."}
        </p>
      )}
      {largest.length > 0 && (
        <details className="coverage-gaps">
          <summary>
            {coverage.gaps.length} {coverage.gaps.length === 1 ? "gap" : "gaps"}{" "}
            over {duration(limits.maxGapSeconds)} · inspect missing periods
          </summary>
          <p>
            Intervals between observed source blocks. Waiting alone does not
            recreate missing observations.
          </p>
          <div className="coverage-gap-scroll">
            <table>
              <thead>
                <tr>
                  <th>Last observation before gap</th>
                  <th>Next observation</th>
                  <th>Interval</th>
                </tr>
              </thead>
              <tbody>
                {largest.map((gap) => (
                  <tr key={`${gap.start}:${gap.end}`}>
                    <td>{utc(gap.start)}</td>
                    <td>{utc(gap.end)}</td>
                    <td>{duration(gap.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {coverage.gaps.length > largest.length && (
            <p>Showing the five largest gaps.</p>
          )}
        </details>
      )}
      <p className="coverage-cutoff">
        Data available at {utc(coverage.availableAt)}. UTC times are based on
        the selected pool’s snapshot.
      </p>
    </section>
  );
}
