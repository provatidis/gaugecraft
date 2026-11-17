import { useEffect, useState } from "react";
import type { MarketRow, Maybe } from "../shared/types.js";
import type { SimulationInput } from "../analysis/math.js";
import { SCENARIO_LABELS, type ScenarioBasis } from "../analysis/scenarios.js";
import { simulateSplit } from "../analysis/split.js";
import { PoolPicker } from "./PoolPicker.js";
import { earningsMoney } from "./format.js";
import "./split.css";

const power = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 });
const name = ({ snapshot: s }: MarketRow) =>
  `${s.token0.symbol} / ${s.token1.symbol} · ${s.address.slice(-4)}`;
function differenceLabel(amount: Maybe) {
  if (amount === null) return "—";
  if (amount === 0) return "Same earnings";
  if (Math.abs(amount) < 0.01)
    return `${amount > 0 ? "Higher" : "Lower"} by < $0.01`;
  return `${earningsMoney(Math.abs(amount))} ${amount > 0 ? "more" : "less"}`;
}

export function SplitComparison({
  row,
  secondId,
  selectSecond,
  rows,
  watch,
  input,
  basis,
  now,
  allocationSettings,
}: {
  row: MarketRow;
  secondId: string;
  selectSecond: (id: string) => void;
  rows: MarketRow[];
  watch: string[];
  input: SimulationInput;
  basis: ScenarioBasis;
  now: number;
  allocationSettings: {
    power: string;
    existing: Record<string, string>;
    setExisting: (values: Record<string, string>) => void;
  };
}) {
  const [open, setOpen] = useState(Boolean(secondId));
  useEffect(() => {
    if (secondId) setOpen(true);
  }, [secondId]);
  const [firstPercent, setFirstPercent] = useState(50);
  const candidates = open
    ? rows.filter(
        ({ snapshot: s }) =>
          s.id !== row.snapshot.id &&
          s.mode === row.snapshot.mode &&
          s.chainId === row.snapshot.chainId,
      )
    : [];
  const second = candidates.find(({ snapshot }) => snapshot.id === secondId);
  const reference = !allocationSettings.power.trim();
  const key = second ? `${second.snapshot.mode}:${second.snapshot.id}` : "";
  const existing = reference ? "0" : (allocationSettings.existing[key] ?? "0");
  const calculate = (scenario: ScenarioBasis) =>
    second
      ? simulateSplit(
          row,
          second,
          firstPercent,
          input,
          Number(existing),
          scenario,
          now,
        )
      : null;
  const estimate = calculate("forecast");
  const stress = calculate("stress");
  const result =
    basis === "forecast"
      ? estimate
      : basis === "stress"
        ? stress
        : calculate(basis);
  const mixed = second && second.forecast.basis !== row.forecast.basis;
  const basisText = (r: MarketRow) =>
    r.forecast.basis === "history"
      ? "history-based"
      : "limited-history baseline";

  return (
    <details
      className="panel split-comparison"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Compare a two-pool split</summary>
      {open && (
        <div className="split-body">
          <p>
            Keep the same total power and compare putting it all in one pool
            with dividing it between two on {row.snapshot.chain}.
          </p>
          {secondId && !second && (
            <p role="status">
              The linked second pool is unavailable for this pool and network.
            </p>
          )}
          {candidates.length === 0 ? (
            <p>No second pool on this network is available in this dataset.</p>
          ) : (
            <>
              <PoolPicker
                row={second}
                rows={candidates}
                watch={watch}
                select={selectSecond}
                purpose="Choose a second pool"
              />
              {second && (
                <>
                  <div className="split-controls">
                    <label className="split-range">
                      <span>Power split</span>
                      <input
                        type="range"
                        min="1"
                        max="99"
                        step="1"
                        value={firstPercent}
                        onChange={(e) =>
                          setFirstPercent(Number(e.target.value))
                        }
                        aria-valuetext={`${firstPercent}% to ${name(row)}, ${100 - firstPercent}% to ${name(second)}`}
                      />
                      <span className="split-proportions">
                        <span>
                          <b>{firstPercent}%</b> {name(row)}
                        </span>
                        <span>
                          <b>{100 - firstPercent}%</b> {name(second)}
                        </span>
                      </span>
                    </label>
                    {!reference && (
                      <label className="field">
                        <span>Already allocated to the second pool</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={existing}
                          onChange={(event) =>
                            allocationSettings.setExisting({
                              ...allocationSettings.existing,
                              [key]: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                  <p>
                    {reference
                      ? "1,000 additional reference power"
                      : `${power.format(input.power)} total power`}{" "}
                    · 48h · Your activation delay and stake duration apply to
                    both pools.
                  </p>
                  {result &&
                    (result.error !== null ? (
                      <p role="status">{result.error}</p>
                    ) : (
                      <>
                        <h3>Split versus the higher-earning single pool</h3>
                        <dl
                          className="split-deltas"
                          aria-label="Split difference over 48 hours"
                        >
                          {(
                            [
                              ["Estimate", estimate],
                              ["Stress", stress],
                            ] as const
                          ).map(([label, comparison]) => {
                            const valid =
                              comparison &&
                              comparison.error === null &&
                              comparison.advantage !== null;
                            const single =
                              valid &&
                              comparison.firstOnly.earnings! >=
                                comparison.secondOnly.earnings!
                                ? row
                                : second;
                            return (
                              <div key={label}>
                                <dt>{label}</dt>
                                <dd>
                                  {valid
                                    ? differenceLabel(comparison.advantage)
                                    : "—"}
                                </dd>
                                {valid && (
                                  <small>vs. all in {name(single)}</small>
                                )}
                              </div>
                            );
                          })}
                        </dl>
                        <h3>{SCENARIO_LABELS[basis]} earnings</h3>
                        <dl
                          className="split-results"
                          aria-label="Modeled earnings over 48 hours"
                        >
                          <div>
                            <dt>All in {name(row)}</dt>
                            <dd>
                              {earningsMoney(result.firstOnly.earnings)}
                              <small>
                                {result.firstOnly.error
                                  ? "Unavailable"
                                  : basisText(row)}
                              </small>
                            </dd>
                          </div>
                          <div>
                            <dt>All in {name(second)}</dt>
                            <dd>
                              {earningsMoney(result.secondOnly.earnings)}
                              <small>
                                {result.secondOnly.error
                                  ? "Unavailable"
                                  : basisText(second)}
                              </small>
                            </dd>
                          </div>
                          <div className="split-total">
                            <dt>Split over 48h</dt>
                            <dd>
                              {earningsMoney(result.total)}
                              <small>
                                {power.format(result.firstPower)} +{" "}
                                {power.format(result.secondPower)} power
                              </small>
                            </dd>
                          </div>
                        </dl>
                        {result.total !== null && (
                          <p>
                            {(basis === "current" || basis === "returning") &&
                              result.advantage !== null &&
                              `${SCENARIO_LABELS[basis]} split difference · ${differenceLabel(result.advantage)}. `}
                            {name(row)} contributes{" "}
                            {earningsMoney(result.firstLeg.earnings)} and{" "}
                            {name(second)} contributes{" "}
                            {earningsMoney(result.secondLeg.earnings)}.
                          </p>
                        )}
                        {(result.firstLeg.error || result.firstOnly.error) && (
                          <p role="status">
                            <b>{name(row)}</b> ·{" "}
                            {result.firstLeg.error ?? result.firstOnly.error}
                          </p>
                        )}
                        {(result.secondLeg.error ||
                          result.secondOnly.error) && (
                          <p role="status">
                            <b>{name(second)}</b> ·{" "}
                            {result.secondLeg.error ?? result.secondOnly.error}
                          </p>
                        )}
                        {mixed && result.total !== null && (
                          <p>
                            The split combines a history-based forecast with a
                            limited-history baseline.
                          </p>
                        )}
                      </>
                    ))}
                  <p className="split-note">
                    Each amount earns its own share of that pool’s fees and
                    scheduled incentives. Check your stake’s cooldown on Aero
                    before reallocating.{" "}
                    <a
                      href="https://app.aero.xyz/docs/guides/staking-and-allocating/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Aero allocation guide
                    </a>
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
