import { evaluateForecast } from "../src/analysis/forecast.js";
import type { Forecast, Mode } from "../src/shared/types.js";
import type { Store } from "./store.js";
import { feeTapeReader } from "./fee-tape-evidence.js";
import { prospectivePerformance } from "./prospective-performance.js";

export function performance(
  store: Store,
  mode: Mode,
  now = Math.floor(Date.now() / 1000),
) {
  const decisions = store.decisions(mode, now);
  const wanted = new Set(
    decisions.flatMap((d) => Object.values(d.choices)).filter(Boolean),
  );
  const selected = store.evaluationForecasts(
    mode,
    now,
    [...wanted].filter((id): id is string => id !== null),
    false,
  );
  const mature = new Map<string, Forecast[]>();
  const feeTape = mode === "live" ? feeTapeReader(store.db) : undefined;
  for (const f of selected) {
    if (f.dueAt > now) continue;
    const group = mature.get(f.poolId);
    if (group) group.push(f);
    else mature.set(f.poolId, [f]);
  }
  // Release each pool's decoded history after evaluating its forecasts.
  const completed = new Map<string, ReturnType<typeof evaluateForecast>>();
  for (const [pool, forecasts] of mature) {
    const from = Math.min(...forecasts.map((f) => f.madeAt)) - 2700;
    const to = Math.min(now, Math.max(...forecasts.map((f) => f.dueAt)) + 2700);
    const history = store.history(mode, pool, from, to, false);
    for (const f of forecasts)
      completed.set(f.id, evaluateForecast(f, history, now, feeTape));
  }
  const evaluations = selected.map(
    (f) => completed.get(f.id) ?? evaluateForecast(f, [], now),
  );
  return {
    evaluations,
    decisions,
    ...(mode === "live"
      ? { prospective: prospectivePerformance(store, now, completed) }
      : {}),
    poolLabels: Object.fromEntries(
      selected.map(({ poolId, input }) => [
        poolId,
        `${input.token0.symbol}/${input.token1.symbol} · ${input.chain}`,
      ]),
    ),
    scope:
      "Latest 250 pending and 500 mature forecasts, plus saved selections from the latest 100 mature collection cohorts.",
    totalStored: store.db
      .prepare("SELECT count(*) n FROM forecasts WHERE mode=?")
      .get(mode)?.n,
  };
}
