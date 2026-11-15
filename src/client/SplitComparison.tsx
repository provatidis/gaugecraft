import { useState } from "react";
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
function splitDifference(split: Maybe, first: Maybe, second: Maybe) {
  if (split === null || first === null || second === null) return null;
  const difference = split - Math.max(first, second);
  return Math.abs(difference) < 0.01
    ? "The split and the higher single-pool estimate are within one cent."
    : `The split is ${earningsMoney(Math.abs(difference))} ${difference > 0 ? "above" : "below"} the higher single-pool estimate in this scenario.`;
}

export function SplitComparison({
  row,
  rows,
  watch,
  input,
  basis,
  now,
  allocationSettings,
}: {
  row: MarketRow;
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
  const [open, setOpen] = useState(false);
  const [secondId, setSecondId] = useState("");
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
  const result = second
    ? simulateSplit(
        row,
        second,
        firstPercent,
        input,
        Number(existing),
        basis,
        now,
      )
    : null;
  const mixed = second && second.forecast.basis !== row.forecast.basis;
  const basisText = (r: MarketRow) =>
    r.forecast.basis === "history"
      ? "history-based"
      : "limited-history baseline";

  return (
    <details
      className="panel split-comparison"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Compare a two-pool split</summary>
      {open && (
        <div className="split-body">
          <p>
            Keep the same total power and compare putting it all in one pool
            with dividing it between two on {row.snapshot.chain}.
          </p>
          {candidates.length === 0 ? (
            <p>No second pool on this network is available in this dataset.</p>
          ) : (
            <>
              <PoolPicker
                row={second}
                rows={candidates}
                watch={watch}
                select={setSecondId}
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
                    <strong>{SCENARIO_LABELS[basis]}</strong> · 48h ·{" "}
                    {reference
                      ? "1,000 additional reference power"
                      : `${power.format(input.power)} total power`}
                    . All three estimates use your activation delay and stake
                    duration.
                  </p>
                  {result &&
                    (result.error !== null ? (
                      <p role="status">{result.error}</p>
                    ) : (
                      <>
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
                            {splitDifference(
                              result.total,
                              result.firstOnly.earnings,
                              result.secondOnly.earnings,
                            )}{" "}
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
