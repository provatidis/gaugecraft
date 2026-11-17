import { useEffect, useState } from "react";
import {
  choices,
  displayApr,
  costs,
  DAY,
  presets,
  pools,
  value,
  WEEK,
  type Frequency,
  type PairName,
  type PilotView,
  type Choice,
} from "../analysis/liquidity.js";
import { get, hosted } from "./data.js";
import "./liquidity.css";
const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const usd = (n: number | null) => (n === null ? "Unavailable" : fmt.format(n));
const date = (at: number) =>
  new Date(at * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
const modeName = {
  fees: "Keep swap fees",
  aero: "Stake for AERO",
  hold: "Hold the tokens",
};
function label(c: Choice | null) {
  return c
    ? c.mode === "hold"
      ? modeName.hold
      : "CL" +
        (pools.find((p) => p.address === c.address)?.spacing ?? "") +
        " · " +
        modeName[c.mode]
    : "Unavailable";
}
export default function Liquidity({ refresh }: { refresh: number }) {
  const [data, setData] = useState<PilotView | null>(null),
    [error, setError] = useState("");
  const [asset, setAsset] = useState<PairName>("WETH"),
    [preset, setPreset] = useState<Frequency>("weekly"),
    [amount, setAmount] = useState("1000");
  useEffect(() => {
    const abort = new AbortController();
    const load = () =>
      get<PilotView>("/api/liquidity", abort.signal)
        .then((x) => {
          setData(x);
          setError("");
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 300000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  const d = data?.latest,
    size = Number(amount),
    valid = Number.isFinite(size) && size > 0;
  const { best, options, pick } = choices(d?.quotes ?? [], asset, preset, size);
  const stale = !!d && Date.now() / 1000 - d.published > 36 * 3600;
  const q = best?.q;
  return (
    <div className="lp-view">
      <section className="panel lp-inputs" aria-label="Position preferences">
        <label>
          Token pair
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as PairName)}
          >
            <option value="WETH">WETH / USDC</option>
            <option value="cbBTC">cbBTC / USDC</option>
          </select>
        </label>
        <label>
          Deposit size in USD
          <input
            inputMode="decimal"
            type="number"
            min="0.01"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          How often can you check it?
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as Frequency)}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="occasional">Less than weekly</option>
          </select>
        </label>
      </section>
      {error && (
        <p className="notice warning" role="alert">
          {hosted
            ? "Live LP research requires a connection to the Gaugecraft service."
            : error}
        </p>
      )}
      {!d && !error && (
        <p role="status">
          {data
            ? "Waiting for the first verified Base observation."
            : "Loading the latest pool observations…"}
        </p>
      )}
      {d && (
        <>
          <p className="lp-asof">
            Decision frozen {date(d.published)} ·{" "}
            <a
              href={"https://basescan.org/block/" + d.block}
              target="_blank"
              rel="noreferrer"
            >
              Base block {d.block.toLocaleString()} ↗
            </a>
          </p>
          {stale && (
            <p className="notice warning">
              This is a historical decision. The latest published inputs are
              over 36 hours old.
            </p>
          )}
          {!valid ? (
            <p className="notice warning">
              Enter a deposit greater than zero to compare positions.
            </p>
          ) : q && best && pick ? (
            <>
              <section
                className="panel lp-decision"
                aria-label="Seven-day decision"
              >
                <div className="eyebrow">Seven-day scenario</div>
                <h2>
                  {pick.mode === "hold"
                    ? "Hold the starting tokens"
                    : modeName[pick.mode] + " in CL" + q.spacing}
                </h2>
                <p>
                  {best.mode === "fees" ? "Keeping fees" : "Staking for AERO"}{" "}
                  in CL{q.spacing} {pick.mode === "hold" ? "trails" : "leads"}{" "}
                  holding by <strong>{usd(Math.abs(best.edge))}</strong> if the
                  past week’s price move and earnings repeat.
                </p>
                <div className="lp-values">
                  <div>
                    <span>Hold the same tokens</span>
                    <strong>{usd(q.hold * size)}</strong>
                  </div>
                  <div>
                    <span>LP after costs</span>
                    <strong>{usd(best.net)}</strong>
                  </div>
                </div>
                <p>
                  Starting mix ·{" "}
                  {(q.units * size).toLocaleString("en-US", {
                    maximumSignificantDigits: 5,
                  })}{" "}
                  {asset} +{" "}
                  {(q.stable * size).toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  USDC
                </p>
                <dl className="lp-breakdown">
                  <dt>Pool and fixed range</dt>
                  <dd>
                    <a
                      href={`https://app.aero.xyz/deposit/8453-${q.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      CL{q.spacing} ↗
                    </a>{" "}
                    · {usd(q.lowUsd)} – {usd(q.highUsd)}
                  </dd>
                  <dt>LP tokens at exit</dt>
                  <dd>{usd(q.principal * size)}</dd>
                  <dt>{best.mode === "fees" ? "Swap fees" : "AERO rewards"}</dt>
                  <dd>
                    {usd((q[best.mode] ?? 0) * size)}
                    {best.mode === "aero" && q.aeroTokens !== null
                      ? " · " + (size * q.aeroTokens).toFixed(2) + " AERO"
                      : ""}
                  </dd>
                  <dt>Entry and exit costs</dt>
                  <dd>−{usd(costs(size))}</dd>
                </dl>
                <p>
                  To beat holding, this range needs more than{" "}
                  <strong>
                    {usd(
                      Math.max(0, (q.hold - q.principal) * size + costs(size)),
                    )}
                  </strong>{" "}
                  in rewards over seven days.
                </p>
                <p className="lp-note">
                  The scenario moves {asset} from {usd(q.spot)} to{" "}
                  {usd(q.endSpot)}{" "}
                  {q.inRange !== null &&
                    `and estimates ${Math.round(q.inRange * 100)}% of the week in range`}
                  . Outside it, the position stops earning and can end up
                  entirely in one token.
                </p>
              </section>
              <details className="panel lp-details">
                <summary>Compare pools, ranges and both reward modes</summary>
                <p>
                  Each row shows the ending LP value after costs. The difference
                  is measured against holding that row’s starting mix.
                </p>
                <div className="lp-alternatives">
                  {d.quotes
                    .filter(
                      (r) =>
                        r.asset === asset &&
                        (presets[preset] as readonly number[]).includes(
                          r.width,
                        ),
                    )
                    .map((r) => (
                      <article key={r.address + r.width}>
                        <strong>
                          CL{r.spacing} · {usd(r.lowUsd)} – {usd(r.highUsd)}
                        </strong>
                        {(["fees", "aero"] as const).map((m) => {
                          const v = value(r, m, size);
                          return (
                            <div key={m}>
                              <span>
                                {modeName[m]}
                                <small>
                                  {displayApr(
                                    m === "fees" ? r.feeApr : r.aeroApr,
                                  ) ?? "—"}
                                  % list-style APR
                                </small>
                              </span>
                              <b>
                                {usd(v)}
                                {v === null && (
                                  <small>
                                    {m === "aero" && r.aeroIssue
                                      ? r.aeroIssue
                                      : "Above the modeled size limit"}
                                  </small>
                                )}
                                {v !== null && (
                                  <small>
                                    {v >= r.hold * size ? "+" : ""}
                                    {usd(v - r.hold * size)} vs hold
                                  </small>
                                )}
                              </b>
                            </div>
                          );
                        })}
                      </article>
                    ))}
                </div>
              </details>
            </>
          ) : (
            <p className="notice warning">
              No eligible comparison for this size. A mode needs complete
              observations and a deposit below 1% of its opening active
              liquidity.
            </p>
          )}
          {valid && options.length < 8 && (
            <p className="lp-note">
              Coverage · {options.length} of 8 pool, range and reward
              combinations qualify for this input. Missing or oversized
              positions are excluded.
            </p>
          )}
          <details className="panel lp-details">
            <summary>How to read the estimate</summary>
            <p>
              Choose a pair you want to own. We compare Base CL50 and CL100 at
              two widths for your check-in frequency. The model leaves each
              range fixed for seven days. It ranks dollar gains over holding the
              exact starting quantities.
            </p>
            <p>
              We replay the last seven days of price moves from today’s price.
              We sample onchain fee and settled AERO growth every six hours and
              estimate the time in range between samples. Fast moves, new
              liquidity, volume or a change in AERO’s price can change the
              ordering. Fees and AERO are alternative reward modes.
            </p>
            <p>
              The estimate assumes USDC at $1, AERO at the decision price and
              combined entry and exit costs of $1 plus 0.10% of the deposit. It
              assumes you already own both tokens in the shown mix. Personal
              swap, bridge and tax costs vary.
            </p>
          </details>
          <details className="panel lp-details">
            <summary>Frozen picks and seven-day results</summary>
            <p>
              {data?.history.length} daily decisions recorded in the 28-day
              pilot. Scores use $1,000, your selected pair and check-in
              frequency. Each pick and APR benchmark has its own starting mix.
              Windows overlap.
            </p>
            <p>
              The benchmark takes the higher of Aero’s list-style Fees APR and
              AERO APR across the two pools, using the narrower preset range and
              Gaugecraft’s block prices. Range counters measure earnings where
              continuity is verified. Other outcomes use six-hour estimates.
            </p>
            {[...(data?.history ?? [])].reverse().map((day) => {
              const row = day.entries.find(
                (e) => e.asset === asset && e.preset === preset,
              );
              if (!row) return null;
              return (
                <article className="lp-score" key={day.at}>
                  <strong>
                    {date(day.published)} · {label(row.pick)}
                  </strong>
                  <span>APR benchmark · {label(row.headline)}</span>
                  {row.score ? (
                    <>
                      <span>
                        Pick {usd(row.score.pickNet)} · hold{" "}
                        {usd(row.score.hold)} · APR choice{" "}
                        {usd(row.score.headlineNet)}
                      </span>
                      <span>
                        Gain over each starting mix · pick{" "}
                        {usd(row.score.pickEdge)} · APR choice{" "}
                        {usd(row.score.headlineEdge)}
                      </span>
                      {day.outcomeBlock && day.outcomeAt && (
                        <a
                          href={`https://basescan.org/block/${day.outcomeBlock}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Closing block · {date(day.outcomeAt)} ↗
                        </a>
                      )}
                      <small>
                        Pick {row.score.pickEvidence} · benchmark{" "}
                        {row.score.headlineEvidence}
                      </small>
                    </>
                  ) : (
                    <span>Score due {date(day.at + WEEK)}</span>
                  )}
                </article>
              );
            })}
            {data?.restoredAt && (
              <p>LP archive restore verified {date(data.restoredAt)}.</p>
            )}
            {data?.started && (
              <p>
                First decision {date(data.started)} · final decision date{" "}
                {new Date((Math.floor(data.started / DAY) + 27) * DAY * 1000)
                  .toISOString()
                  .slice(0, 10)}{" "}
                UTC.
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
