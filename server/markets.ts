import type { MarketRow, Mode, Snapshot } from "../src/shared/types.js";
import { persistenceCoverage } from "../src/analysis/coverage.js";
import { forecast } from "../src/analysis/forecast.js";
import { HOUR, HORIZON, percentChange } from "../src/analysis/math.js";
import type { Store } from "./store.js";

function forecastHistory(store: Store, snapshot: Snapshot) {
  return store.history(
    snapshot.mode,
    snapshot.id,
    snapshot.observedAt - HORIZON,
    snapshot.observedAt,
    false,
  );
}

export function poolCoverage(store: Store, mode: Mode, id: string, at: number) {
  const snapshot = store.latestInWindow(mode, id, at, at, false);
  if (!snapshot) return null;
  return persistenceCoverage(snapshot, forecastHistory(store, snapshot));
}

export function markets(
  store: Store,
  mode: Mode,
  includeCoverage = true,
): MarketRow[] {
  return store.latestMarketInputs(mode).map(({ snapshot, frozen }) => {
    const history =
      includeCoverage || !frozen ? forecastHistory(store, snapshot) : null;
    const cutoff = snapshot.observedAt - 6 * HOUR;
    const prior = history
      ? history.findLast((s) => s.observedAt <= cutoff)
      : store.latestInWindow(
          mode,
          snapshot.id,
          snapshot.observedAt - HORIZON,
          cutoff,
          false,
        );
    return {
      coverage: includeCoverage
        ? persistenceCoverage(snapshot, history!)
        : undefined,
      snapshot,
      forecast: frozen ?? forecast(snapshot, history!),
      aprChange:
        snapshot.stakeApr === null || prior?.stakeApr == null
          ? null
          : snapshot.stakeApr - prior.stakeApr,
      allocationChange: percentChange(
        snapshot.allocation,
        prior?.allocation ?? null,
      ),
    };
  });
}

// In a current market row the forecast input is its immutable observation.
// The overview sends it once. The client restores the usual MarketRow shape.
export function overviewRows(rows: MarketRow[]) {
  return rows.map((row) => ({
    ...row,
    forecast: { ...row.forecast, input: undefined },
  }));
}
