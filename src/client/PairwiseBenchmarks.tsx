import {
  BENCHMARK_NAMES,
  type performanceSummary,
} from "../analysis/performance-summary.js";
import { earningsDifference, earningsMoney } from "./format.js";
import { feeTimingNote } from "./fee-timing-note.js";
import "./benchmarks.css";

export function PairwiseBenchmarks({
  comparisons,
  shortlistAccuracy,
  total,
}: {
  comparisons: ReturnType<typeof performanceSummary>["comparisons"];
  shortlistAccuracy: ReturnType<typeof performanceSummary>["shortlistAccuracy"];
  total: number;
}) {
  return (
    <section
      className="panel comparison-benchmarks"
      aria-labelledby="benchmark-title"
    >
      <div className="panel-header">
        <div>
          <h2 id="benchmark-title">How did the shortlist compare?</h2>
          <p>
            Mean earnings for 1,000 additional power. Both picks come from the
            same saved decision. Each pool’s 48 hours start at its own
            observation, and both outcomes need complete data.
          </p>
        </div>
      </div>
      {total === 0 ? (
        <p className="benchmark-note">
          No mature saved selections are available yet. The first comparison
          needs a 48-hour window and complete observations for both picks.
        </p>
      ) : (
        <>
          {shortlistAccuracy.matched > 0 && (
            <p className="benchmark-note">
              In {shortlistAccuracy.matched} of {total} saved decisions, the
              shortlist’s top pick had both a forecast and a complete outcome.
              Its mean forecast before the stress adjustment was{" "}
              <strong>{earningsMoney(shortlistAccuracy.forecast)}</strong> and
              its mean observed earnings proxy was{" "}
              <strong>{earningsMoney(shortlistAccuracy.observed)}</strong> per
              1,000 additional power over 48 hours.
            </p>
          )}
          <p className="benchmark-note">{feeTimingNote}</p>
          <div className="benchmark-pairs">
            {comparisons.map((row) => (
              <article key={row.key} className="benchmark-pair">
                <h3>{BENCHMARK_NAMES[row.key]}</h3>
                <p>
                  {row.matched} of {total} windows matched
                </p>
                {row.counterWindows > 0 && (
                  <p>
                    {row.counterWindows} matched{" "}
                    {row.counterWindows === 1 ? "window used" : "windows used"}{" "}
                    recorded pool fee counters for at least one pick.
                  </p>
                )}
                <dl>
                  <div>
                    <dt>Shortlist</dt>
                    <dd>{earningsMoney(row.shortlistMean)}</dd>
                  </div>
                  <div>
                    <dt>Benchmark</dt>
                    <dd>{earningsMoney(row.benchmarkMean)}</dd>
                  </div>
                  <div>
                    <dt>Shortlist difference</dt>
                    <dd>{earningsDifference(row.meanDifference)}</dd>
                  </div>
                </dl>
                {row.matched > 0 && (
                  <p>
                    Both rules picked the same pool in {row.samePick} of{" "}
                    {row.matched} matched windows.
                  </p>
                )}
                {row.exclusions.length > 0 && (
                  <details>
                    <summary>
                      Why {total - row.matched}{" "}
                      {total - row.matched === 1
                        ? "window was"
                        : "windows were"}{" "}
                      excluded
                    </summary>
                    <p>
                      Counts show the first missing requirement for each pick. A
                      window can appear for both picks.
                    </p>
                    <ul>
                      {row.exclusions.map(([reason, count]) => (
                        <li key={reason}>
                          <strong>{count}</strong> · {reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
          </div>
          <p className="benchmark-note">
            Each benchmark can match a different set of windows. Consecutive
            48-hour windows overlap, so a run of similar outcomes can reflect
            the same market activity.
          </p>
        </>
      )}
    </section>
  );
}
