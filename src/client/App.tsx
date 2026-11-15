import React, { useEffect, useMemo, useRef, useState } from "react";
import { money, number, earningsMoney, pct, date } from "./format.js";
import type {
  Evaluation,
  HistoryPoint,
  MarketRow,
  Mode,
  Run,
  Snapshot,
} from "../shared/types.js";
import {
  HORIZON,
  incentives,
  SCENARIOS,
  type SimulationInput,
} from "../analysis/math.js";
import { simulateAllocation, SCENARIO_LABELS } from "../analysis/scenarios.js";
import {
  BENCHMARK_NAMES,
  performanceSummary,
} from "../analysis/performance-summary.js";
import { PairwiseBenchmarks } from "./PairwiseBenchmarks.js";
import { get, assetUrl, exportUrl, hosted } from "./data.js";
import { dataHealth, isFresh } from "../analysis/freshness.js";
import {
  allocationEarnings,
  compareEarnings,
  EVIDENCE_LABELS,
  type EarningsComparison,
} from "../analysis/earnings.js";
import { splitCompatibilityError } from "../analysis/split.js";
import { shortlist } from "./shortlist.js";
import { AllocationSize } from "./AllocationSize.js";
import { SplitComparison } from "./SplitComparison.js";
import { PoolPicker } from "./PoolPicker.js";
import { PoolCoverage } from "./Coverage.js";
import { ThemeSelect } from "./ThemeSelect.js";
import { InstallApp } from "./InstallApp.js";
import { matchesPool } from "./pool-search.js";
import { MetricHelp } from "./MetricHelp.js";
import { useObservationClock } from "./useObservationClock.js";
import { useResearchRoute } from "./useResearchRoute.js";
import {
  emptyFilters,
  type MarketFilters,
  type Page,
  type ScenarioBasis,
} from "./research-route.js";
import { ContextHelp, GettingStarted, Guide } from "./Guide.js";
const HistoryChart = React.lazy(() => import("./HistoryChart.js"));
// A tab can outlive the deployment that supplied its chart chunk.
class ChartBoundary extends React.Component<React.PropsWithChildren> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="notice warning" role="status">
        The chart display could not be loaded.{" "}
        <button className="text-link" onClick={() => window.location.reload()}>
          Reload charts
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-4);
function useLocal<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  });
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* Storage may be disabled; inputs still work in memory. */
      }
    },
  ];
}
interface AllocationSettings {
  power: string;
  setPower: (power: string) => void;
  existing: Record<string, string>;
  setExisting: (values: Record<string, string>) => void;
}
function initialPower() {
  try {
    const prior = JSON.parse(
      localStorage.getItem("gc-simulator") ?? "{}",
    ).power;
    return typeof prior === "string" && prior !== "1000" ? prior : "";
  } catch {
    return "";
  }
}
const positionKey = (s: Snapshot) => `${s.mode}:${s.id}`;
function comparison(row: MarketRow, settings: AllocationSettings, now: number) {
  const reference = settings.power.trim() === "";
  return allocationEarnings(
    row,
    reference ? 1000 : Number(settings.power),
    reference ? 0 : Number(settings.existing[positionKey(row.snapshot)] ?? "0"),
    now,
  );
}
interface State {
  mode: Mode;
  now: number;
  markets: MarketRow[];
  runs: Run[];
  collectorEnabled: boolean;
  collectionKind?: "github-actions" | "persistent-service";
  configuredChains: number[];
}
const metricInfo: Record<string, string> = {
  pool: "Chain ID plus pool contract address uniquely identifies each market. Token symbols alone are not unique.",
  earnings:
    "Modeled USD earnings for the entered total power (or 1,000 additional reference power), including own dilution. History-based estimates and full-window baselines are sorted separately. Assumes immediate allocation and constant own power; use Simulator for timing and decay.",
  stress:
    "Same power, with forecast fees reduced 50% and other projected allocation increased 50%. Scheduled incentive USD value is unchanged. A stress assumption, not a confidence interval.",
  evidence:
    "History-based estimates meet the persistence coverage requirements. Baselines hold current conditions constant. Partial fee windows cannot support a comparable 48-hour earnings estimate.",
  stakeApr:
    "Annualized pool revenue estimate ÷ (current reward allocation power × AERO spot price) × 182.5 × 100. This is Stake APR, not LP APR or your personal capital APR.",
  rewards48hUsd:
    "All allocators share this pool total. Historical eligible fee approximation + fixed onchain incentives overlapping the next 48 hours. Not your individual earnings.",
  eligibleFees48hUsd:
    "Observed gross trading fees in the returned window × current staked-liquidity fraction. This approximates historical eligibility; it is not exact fee-distribution accounting.",
  incentives48hUsd:
    "Fixed onchain program rates integrated over the next 48 hours, stopping at expiry, valued at current spot estimates. No renewals assumed.",
  allocation:
    "Current decayed reward voting supply from VotingRewardsManager.totalSupply(), in 18-decimal allocation power units.",
  tvlUsd:
    "Pool reserves valued at local spot price estimates; zero or unknown prices do not silently become zero TVL.",
  volume48hUsd:
    "Observed token-side trading volumes valued at current spot prices and divided by two to avoid counting both legs. Actual source window may be shorter at launch.",
  aprChange:
    "Change in Stake APR in percentage points versus the last observation at least 6 hours earlier.",
  allocationChange:
    "Percentage change in reward allocation supply versus the last observation at least 6 hours earlier. Includes stake decay, not just new competitors.",
};
const nav = [
  ["opportunities", "↗", "Opportunities"],
  ["markets", "◫", "Markets"],
  ["analysis", "⌁", "Pool analysis"],
  ["simulator", "⊞", "Simulator"],
  ["performance", "▥", "Performance"],
] as const;
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Pair({ s, small = false }: { s: Snapshot; small?: boolean }) {
  return (
    <div className={`pair ${small ? "small" : ""}`}>
      <div className="coins">
        <span>{s.token0.symbol.slice(0, 1)}</span>
        <span>{s.token1.symbol.slice(0, 1)}</span>
      </div>
      <div>
        <strong>
          {s.token0.symbol} <span className="muted">/</span> {s.token1.symbol}
        </strong>
        <div className="pair-meta">
          {s.chain} <span>·</span> {s.poolType > 0 ? "CL" : "Basic"}{" "}
          <span>·</span> <span title={s.id}>{short(s.address)}</span>
        </div>
      </div>
    </div>
  );
}
function Info({ name, label }: { name: string; label: string }) {
  return (
    <span className="metric-label">
      {label} <MetricHelp label={label} text={metricInfo[name]} />
    </span>
  );
}
export default function App() {
  const [savedMode] = useLocal<Mode>("gc-mode", "live");
  const {
    route,
    update: updateRoute,
    scrollRevision,
    scrollTarget,
  } = useResearchRoute(savedMode);
  const { mode, page, pool: selected } = route;
  const now = useObservationClock();
  const marketScroll = useRef({ top: 0, left: 0 });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem("gc-mode", JSON.stringify(mode));
    } catch {
      /* Browser storage is optional. */
    }
  }, [mode]);
  const setSelected = (pool: string) => updateRoute({ pool, compareWith: "" });
  const setMode = (mode: Mode) =>
    updateRoute({
      mode,
      pool: "",
      compareWith: "",
      market: { ...emptyFilters },
    });
  const [watch, setWatch] = useLocal<string[]>("gc-watchlist", []);
  const [power, setPower] = useLocal<string>(
    "gc-allocation-power",
    initialPower(),
  );
  const [existing, setExisting] = useLocal<Record<string, string>>(
    "gc-existing-by-pool",
    {},
  );
  const allocationSettings = { power, setPower, existing, setExisting };
  const [guideDismissed, setGuideDismissed] = useLocal<boolean>(
    "gc-guide-dismissed",
    false,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page) {
      heading.current?.focus({ preventScroll: true });
      previousPage.current = page;
    }
  }, [page]);
  function navigate(next: Page) {
    updateRoute({
      page: next,
      compareWith: "",
      ...(["analysis", "simulator"].includes(next) && current
        ? { pool: current.snapshot.id }
        : {}),
      ...(next === "simulator" ? { scenario: "forecast" as const } : {}),
    });
  }
  const showGuide = () => navigate("guide");
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    setLoading(true);
    setError("");
    setState((previous) => (previous?.mode === mode ? previous : null));
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      return get<State>(`/api/state?mode=${mode}`, abort.signal)
        .then((s) => {
          if (alive) {
            setState(s);
            setError("");
            setLoading(false);
          }
        })
        .catch((e) => {
          if (alive && e.name !== "AbortError") {
            setError(e.message);
            setLoading(false);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    const resume = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false;
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [mode, refresh]);
  const rows = useMemo(
    () => (state?.mode === mode ? state.markets : []),
    [state, mode],
  );
  const readyToRestore = rows.length > 0;
  useEffect(() => {
    if (!readyToRestore) return;
    const target = scrollTarget.current;
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: target, behavior: "instant" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [scrollRevision, readyToRestore, scrollTarget]);
  const estimates = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.snapshot.id,
          comparison(r, allocationSettings, now),
        ]),
      ),
    [rows, power, existing, now],
  );
  const screen = useMemo(
    () => shortlist(rows, estimates, route.market.chain),
    [rows, estimates, route.market.chain],
  );
  const current = selected
    ? rows.find((r) => r.snapshot.id === selected)
    : (screen.visible[0] ??
      rows.find(
        (r) =>
          r.snapshot.active &&
          (route.market.chain === "all" ||
            r.snapshot.chain === route.market.chain),
      ) ??
      rows[0]);
  useEffect(() => {
    if (!selected && current && ["analysis", "simulator"].includes(page))
      updateRoute({ pool: current.snapshot.id }, true);
  }, [selected, current?.snapshot.id, page]);
  const health = dataHealth(
    rows,
    state?.configuredChains ?? [],
    state?.runs ?? [],
    mode,
    now,
  );
  const last = health.newest;
  function open(
    row: MarketRow,
    p: Page = "analysis",
    scenario: ScenarioBasis = "forecast",
  ) {
    updateRoute({ pool: row.snapshot.id, page: p, scenario, compareWith: "" });
  }
  const stale = mode === "live" && health.stalePools > 0;
  const healthy =
    mode === "demo" ||
    (!stale &&
      health.issues === 0 &&
      health.currentNetworks === health.networks.length);
  const performanceRevision = `${Math.floor(now / 60)}:${refresh}`;
  return (
    <div className={`shell page-${page}`}>
      <aside className="sidebar">
        <a
          className="brand"
          aria-label="Gaugecraft opportunities"
          href="#opportunities"
          onClick={(e) => {
            e.preventDefault();
            navigate("opportunities");
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            <img
              src={assetUrl("brand-mark-inverse.svg?v=graphite-blue")}
              alt=""
            />
          </span>
          <span>
            gaugecraft<small>ALLOCATION RESEARCH</small>
          </span>
        </a>
        <div className="sidebar-caption">RESEARCH WORKSPACE</div>
        <nav aria-label="Research sections">
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              className={page === id ? "nav-item active" : "nav-item"}
              onClick={() => navigate(id)}
              title={label}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
            >
              <span>{icon}</span>
              <span className="nav-label">{label}</span>
              <span className="mobile-nav-label">
                {
                  {
                    markets: "Markets",
                    opportunities: "Shortlist",
                    analysis: "Analyze",
                    simulator: "Simulate",
                    performance: "Results",
                  }[id]
                }
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="research-note">
            <span className="status-dot" />
            Read-only by design
            <p>
              Your research stays on this device.
              <br />
              No wallet connection.
            </p>
          </div>
          <a href={assetUrl("SOURCES.md")} target="_blank" rel="noreferrer">
            Sources & methodology ↗
          </a>
          <span className="version">Aero / MetaDEX03 · v0.1</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <b>
              {page === "guide"
                ? "How to use"
                : nav.find((n) => n[0] === page)?.[2]}
            </b>
          </div>
          <button
            className="button secondary mobile-tools-toggle"
            aria-expanded={toolsOpen}
            aria-controls="workspace-tools"
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            View options <span aria-hidden="true">{toolsOpen ? "−" : "+"}</span>
          </button>
          <div
            id="workspace-tools"
            className={`top-actions ${toolsOpen ? "is-open" : ""}`}
          >
            <ThemeSelect />
            <button
              className="guide-button"
              onClick={showGuide}
              aria-current={page === "guide" ? "page" : undefined}
            >
              <span aria-hidden="true">?</span> How to use
            </button>
            <InstallApp />
            <a
              className="mobile-export text-link"
              href={exportUrl(mode)}
              download={`gaugecraft-${mode}.csv`}
            >
              Export observations ↓
            </a>
            <span className="utc-date">
              {new Date().toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
            <select
              aria-label="Data source mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="live">Live observations</option>
              <option value="demo">Sample fixtures</option>
            </select>
            <button
              className={`icon-button ${loading ? "refreshing" : ""}`}
              title="Refresh observations"
              aria-label="Refresh observations"
              aria-busy={loading}
              disabled={loading}
              onClick={() => setRefresh((r) => r + 1)}
            >
              ↻
            </button>
          </div>
        </header>
        <main>
          {mode === "demo" && (
            <div className="notice demo">
              <b>Sample fixtures</b> Every pool, metric and historical
              observation in this view is synthetic. This is not live Aero data.
            </div>
          )}
          {error && (
            <div className="notice danger" role="alert">
              {error} {state ? "Showing the last loaded observations." : ""}
            </div>
          )}
          {selected &&
            readyToRestore &&
            !rows.some((r) => r.snapshot.id === selected) &&
            ["analysis", "simulator"].includes(page) && (
              <div className="notice warning">
                The linked pool is unavailable in this dataset.{" "}
                <button
                  className="text-link"
                  onClick={() => updateRoute({ page: "markets", pool: "" })}
                >
                  Find a pool in Markets →
                </button>
              </div>
            )}
          {stale && (
            <div className="notice warning">
              <b>
                {health.stalePools}{" "}
                {health.stalePools === 1 ? "pool has" : "pools have"} stale
                observations.
              </b>{" "}
              These observations are more than 75 minutes old and are excluded
              from opportunity comparisons. Check data health below for network
              details.
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">AERO PREDICTIVE ALLOCATION</div>
              <h1 ref={heading} tabIndex={-1}>
                {page === "guide"
                  ? "How to use Gaugecraft"
                  : page === "markets"
                    ? "Allocation markets"
                    : page === "opportunities"
                      ? "Allocation opportunities"
                      : page === "analysis"
                        ? "Pool analysis"
                        : page === "simulator"
                          ? "Allocation simulator"
                          : "Forecast performance"}
              </h1>
              <p>
                {page === "guide"
                  ? "A short path from headline APR to an informed allocation scenario."
                  : page === "markets"
                    ? "Browse the pool directory by token, network or address. Star pools to revisit them."
                    : page === "opportunities"
                      ? "Compare 48-hour earnings for your stake."
                      : page === "analysis"
                        ? "A record of what was observable, with each estimate kept in context."
                        : page === "simulator"
                          ? "Test your power in one pool or compare a split across two pools on the same network."
                          : "Frozen forecasts, observed outcomes, and simple benchmarks."}
              </p>
            </div>
            {page === "markets" && (
              <a
                className="button secondary"
                href={exportUrl(mode)}
                download={`gaugecraft-${mode}.csv`}
                title={
                  hosted
                    ? "Published observations from the last 30 days"
                    : "Stored observations from the last 30 days; use the CLI to export full history"
                }
              >
                ↓ Export observations
              </a>
            )}
          </div>
          <div className="freshness" role="status">
            <span className={`status-dot ${last && healthy ? "" : "amber"}`} />
            <b>
              {mode === "demo"
                ? "Fixture dataset"
                : last
                  ? "Onchain observations"
                  : loading
                    ? "Loading observations…"
                    : "No retrieval available"}
            </b>
            <span>{last ? `Latest retrieval ${date(last)}` : ""}</span>
            {mode === "live" && state && (
              <span
                className={`health-pill ${healthy ? "" : "attention"}`}
                title={
                  health.oldest
                    ? `Oldest retained pool observation: ${date(health.oldest)}. Current means every pool observation on a network is within 75 minutes.`
                    : "Waiting for successful collection."
                }
              >
                {health.currentNetworks}/{health.networks.length} networks
                current
                {health.issues > 0
                  ? ` · ${health.issues} collection ${health.issues === 1 ? "issue" : "issues"}`
                  : ""}
              </span>
            )}
            <span className="freshness-end">
              48h horizon <span>·</span>{" "}
              {hosted ? "Scheduled snapshots" : "30 min collection"}
            </span>
          </div>
          {page === "markets" && !guideDismissed && (
            <GettingStarted
              onGuide={showGuide}
              onDismiss={() => {
                setGuideDismissed(true);
                heading.current?.focus({ preventScroll: true });
              }}
            />
          )}
          {page !== "guide" &&
            page !== "markets" &&
            page !== "opportunities" && (
              <ContextHelp page={page} onGuide={showGuide} />
            )}
          {page === "opportunities" && (
            <AllocationSize
              value={power}
              onChange={setPower}
              showAssumptions={false}
            >
              <label>
                <span>Network</span>
                <select
                  value={route.market.chain}
                  onChange={(event) =>
                    updateRoute(
                      {
                        pool: "",
                        compareWith: "",
                        market: {
                          ...route.market,
                          chain: event.target.value,
                          page: 0,
                        },
                      },
                      true,
                    )
                  }
                >
                  <option value="all">All networks</option>
                  {[
                    ...new Set([
                      ...rows.map((r) => r.snapshot.chain),
                      ...(route.market.chain !== "all"
                        ? [route.market.chain]
                        : []),
                    ]),
                  ]
                    .sort()
                    .map((chain) => (
                      <option key={chain}>{chain}</option>
                    ))}
                </select>
              </label>
            </AllocationSize>
          )}
          {page === "guide" ? (
            <Guide navigate={navigate} />
          ) : loading && !state ? (
            <div className="loading">
              <div className="spinner" />
              Reading observations…
            </div>
          ) : error && !state ? (
            <button
              className="button secondary"
              onClick={() => setRefresh((v) => v + 1)}
            >
              Retry loading observations
            </button>
          ) : rows.length === 0 ? (
            <div className="empty panel">
              <span className="empty-symbol">◫</span>
              <h2>
                {mode === "demo"
                  ? "Fixtures have not been seeded."
                  : "No live observations yet."}
              </h2>
              <p>
                {mode === "demo"
                  ? "Run “npm run demo” locally to create a separate, explicitly synthetic dataset."
                  : "The collector is reading public contracts. Successful observations will appear here automatically."}
              </p>
              {state?.runs
                .filter((r) => r.status === "error")
                .slice(0, 2)
                .map((r) => (
                  <p key={r.id} className="error-text">
                    Chain {r.chainId}: {r.error}
                  </p>
                ))}
            </div>
          ) : (
            <>
              {page === "markets" && (
                <Markets
                  rows={rows}
                  open={open}
                  watch={watch}
                  setWatch={setWatch}
                  allocationSettings={allocationSettings}
                  now={now}
                  estimates={estimates}
                  filters={route.market}
                  onFiltersChange={(market) => {
                    marketScroll.current = { top: 0, left: 0 };
                    updateRoute({ market }, true);
                  }}
                  scrollMemory={marketScroll}
                />
              )}
              {page === "opportunities" && (
                <Opportunities
                  screen={screen}
                  rows={rows}
                  compareWith={route.compareWith}
                  selectForSplit={(compareWith) => updateRoute({ compareWith })}
                  openSplit={(first, second) =>
                    updateRoute({
                      page: "simulator",
                      pool: first.snapshot.id,
                      compareWith: second.snapshot.id,
                      scenario: "forecast",
                    })
                  }
                  estimates={estimates}
                  power={power}
                  open={open}
                  browse={() =>
                    updateRoute({
                      page: "markets",
                      market: { ...emptyFilters, chain: route.market.chain },
                    })
                  }
                />
              )}
              {page === "analysis" && current && (
                <Analysis
                  row={current}
                  rows={rows}
                  select={setSelected}
                  watch={watch}
                  mode={mode}
                  revision={refresh}
                  simulate={() => open(current, "simulator")}
                />
              )}
              {page === "simulator" && current && (
                <Simulator
                  row={current}
                  compareWith={route.compareWith}
                  selectSecond={(compareWith) =>
                    updateRoute({ compareWith }, true)
                  }
                  rows={rows}
                  select={setSelected}
                  watch={watch}
                  allocationSettings={allocationSettings}
                  now={now}
                  basis={route.scenario}
                  setBasis={(scenario) => updateRoute({ scenario }, true)}
                />
              )}
              {page === "performance" && (
                <Performance
                  mode={mode}
                  rows={rows}
                  revision={performanceRevision}
                />
              )}
            </>
          )}
          <footer>
            <span>
              Research estimates. Returns are variable. USD values use pool spot
              estimates and configured USDC / USDG = $1 anchors.
            </span>
            <a href={assetUrl("SOURCES.md")} target="_blank" rel="noreferrer">
              Read the methodology ↗
            </a>
          </footer>
          {state && (
            <details className="source-health">
              <summary>
                Data health ·{" "}
                {mode === "demo"
                  ? "Sample fixture namespace"
                  : `${health.currentNetworks}/${health.networks.length} networks current${health.issues ? ` · ${health.issues} collection issues` : ""}`}
              </summary>
              <p>
                {state.collectionKind === "github-actions"
                  ? "Public chain observations are refreshed by GitHub Actions, scheduled twice an hour. Runs may be delayed or fail; the retrieval timestamp shows actual freshness. History is retained between runs. Your personal inputs never enter the collector."
                  : state.collectorEnabled
                    ? "Collection runs every 30 minutes while the service is running. Retrieval timestamps show actual freshness."
                    : "Background collection is disabled for this server."}
              </p>
              {mode === "live" && (
                <div className="network-health">
                  {health.networks.map((network) => (
                    <div key={network.id}>
                      <span
                        className={`status-dot ${network.current && network.run?.status !== "error" && network.run?.status !== "partial" ? "" : "amber"}`}
                      />
                      <b>{network.name}</b>
                      <span>
                        {network.retrievedAt
                          ? date(network.retrievedAt)
                          : "No observations yet"}
                      </span>
                      <small>
                        {network.run?.error ??
                          (network.current
                            ? "Current observations"
                            : "Waiting for fresh observations")}
                      </small>
                    </div>
                  ))}
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Network</th>
                      <th>Started (UTC)</th>
                      <th>Status</th>
                      <th>Pools</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.runs.slice(0, 10).map((r) => (
                      <tr key={r.id}>
                        <td>{r.chainId}</td>
                        <td>{date(r.startedAt)}</td>
                        <td>{r.status}</td>
                        <td>{r.poolCount}</td>
                        <td>{r.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </main>
      </div>
    </div>
  );
}
function Markets({
  rows,
  open,
  watch,
  setWatch,
  allocationSettings,
  now,
  estimates,
  filters,
  onFiltersChange,
  scrollMemory,
}: {
  rows: MarketRow[];
  open: (r: MarketRow, p?: Page, scenario?: ScenarioBasis) => void;
  watch: string[];
  setWatch: (s: string[]) => void;
  allocationSettings: AllocationSettings;
  now: number;
  estimates: Map<string, EarningsComparison>;
  filters: MarketFilters;
  onFiltersChange: (filters: MarketFilters) => void;
  scrollMemory: React.RefObject<{ top: number; left: number }>;
}) {
  const { search, chain, starred, page, evidence } = filters;
  const filter = (patch: Partial<MarketFilters>) =>
    onFiltersChange({ ...filters, page: 0, ...patch });
  const setPage = (page: number) => filter({ page });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  function turnPage(page: number) {
    setPage(page);
    requestAnimationFrame(() =>
      panel.current?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  }
  const [sorting, setSorting] = useLocal("gc-market-sort", {
    key: "earnings",
    descending: true,
  });
  const sort = sorting.key,
    desc = sorting.descending;
  const personalSort = sort === "earnings" || sort === "stress";
  const comparableCount = [...estimates.values()].filter(
    (e) => e.earnings !== null,
  ).length;
  const [view, setView] = useLocal<"focus" | "all">("gc-market-view", "focus");
  const active = rows.filter((r) => r.snapshot.active),
    knownRewards = active.filter((r) => r.snapshot.rewards48hUsd !== null),
    knownTvl = active.filter((r) => r.snapshot.tvlUsd !== null),
    ready = active.filter(
      (r) => estimates.get(r.snapshot.id)?.basis === "history",
    );
  const partialWindows = active.filter(
    (r) => r.snapshot.windowEnd - r.snapshot.windowStart < 47 * 3600,
  ).length;
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => {
          const s = r.snapshot;
          return (
            (evidence === "all" || estimates.get(s.id)?.basis === evidence) &&
            (chain === "all" || s.chain === chain) &&
            (!starred || watch.includes(s.id)) &&
            matchesPool(r, search)
          );
        })
        .sort((a, b) => {
          if (sort === "earnings" || sort === "stress") {
            return (
              compareEarnings(
                estimates.get(a.snapshot.id)!,
                estimates.get(b.snapshot.id)!,
                sort,
                desc,
              ) || a.snapshot.id.localeCompare(b.snapshot.id)
            );
          }
          const value = (r: MarketRow): number | string | null =>
            sort === "pool"
              ? `${r.snapshot.token0.symbol}/${r.snapshot.token1.symbol}`
              : sort === "aprChange"
                ? r.aprChange
                : sort === "allocationChange"
                  ? r.allocationChange
                  : (r.snapshot[sort as keyof Snapshot] as number | null);
          const av = value(a),
            bv = value(b);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (
            (typeof av === "string"
              ? av.localeCompare(String(bv))
              : av - Number(bv)) * (desc ? -1 : 1)
          );
        }),
    [rows, chain, starred, watch, search, sort, desc, evidence, estimates],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 25) - 1),
  );
  const columns = [
    ["pool", "Pool"],
    ["earnings", "Earnings / 48h"],
    ["stress", "Stress / 48h"],
    ["evidence", "Evidence"],
    ["rewards48hUsd", "Pool rewards / 48h"],
    ["eligibleFees48hUsd", "Eligible fees"],
    ["incentives48hUsd", "Incentives 48h"],
    ["allocation", "Allocation power"],
    ["stakeApr", "Stake APR"],
    ["tvlUsd", "TVL"],
    ["volume48hUsd", "Volume · observed"],
    ["aprChange", "APR Δ 6h"],
    ["allocationChange", "Allocation Δ 6h"],
  ];
  function sortBy(key: string) {
    setSorting({ key, descending: sort === key ? !desc : true });
    setPage(0);
  }
  function clearFilters() {
    onFiltersChange({ ...emptyFilters });
  }
  const visible = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  const activeFilters =
    Number(chain !== "all") + Number(evidence !== "all") + Number(starred);
  return (
    <>
      <AllocationSize
        value={allocationSettings.power}
        onChange={(value) => {
          allocationSettings.setPower(value);
          setPage(0);
        }}
      />
      <details className="market-overview">
        <summary>
          Market overview · {active.length} active pools · {ready.length} with
          history-based earnings
        </summary>
        <div className="stat-grid">
          <Stat
            label="Allocation markets"
            value={number(active.length)}
            detail={`${rows.length - active.length} inactive · chain-aware identities`}
          />
          <Stat
            label="Pool rewards · next 48h"
            value={money(
              knownRewards.length
                ? knownRewards.reduce(
                    (a, r) => a + r.snapshot.rewards48hUsd!,
                    0,
                  )
                : null,
              true,
            )}
            detail={`Estimate · ${knownRewards.length}/${active.length} pools priced`}
          />
          <Stat
            label="Tracked liquidity"
            value={money(
              knownTvl.length
                ? knownTvl.reduce((a, r) => a + r.snapshot.tvlUsd!, 0)
                : null,
              true,
            )}
            detail={`Spot estimate · ${knownTvl.length}/${active.length} pools priced`}
          />
          <Stat
            label="History-based earnings"
            value={`${ready.length} pools`}
            detail={
              ready.length
                ? "Comparable at the selected power"
                : "No qualifying estimates at this size"
            }
            highlight={ready.length > 0}
          />
        </div>
      </details>
      <section ref={panel} className={`panel market-panel mode-${view}`}>
        <div className="panel-header">
          <div>
            <h2>
              Markets <span className="count">{rows.length}</span>
            </h2>
            <p>
              {allocationSettings.power.trim() === ""
                ? "Earnings for 1,000 additional reference power."
                : "Earnings for your intended total power in each pool."}{" "}
              Pool rewards remain shared totals.
            </p>
          </div>
          <label className="market-sort">
            Sort by
            <select
              aria-label="Sort markets"
              value={sort}
              onChange={(e) => {
                setSorting({ key: e.target.value, descending: true });
                setPage(0);
              }}
            >
              <option value="earnings">Estimated earnings</option>
              <option value="stress">Stress-case earnings</option>
              <option value="rewards48hUsd">Pool-wide rewards</option>
              {!["earnings", "stress", "rewards48hUsd"].includes(sort) && (
                <option value={sort}>
                  {columns.find((c) => c[0] === sort)?.[1] ?? sort}
                </option>
              )}
            </select>
          </label>
        </div>
        <div className="toolbar">
          <label className="search">
            <span>⌕</span>
            <input
              aria-label="Search pools"
              placeholder="Search tokens, pool address or network"
              value={search}
              onChange={(e) => {
                filter({ search: e.target.value });
              }}
            />
          </label>
          <button
            className="button secondary mobile-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="market-filter-options"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            Filters{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
          <div
            id="market-filter-options"
            className={`filter-options ${filtersOpen ? "is-open" : ""}`}
          >
            <select
              aria-label="Filter network"
              value={chain}
              onChange={(e) => {
                filter({ chain: e.target.value });
              }}
            >
              <option value="all">All networks</option>
              {[...new Set(rows.map((r) => r.snapshot.chain))]
                .sort()
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
            <select
              aria-label="Filter evidence"
              value={evidence}
              onChange={(e) => {
                filter({ evidence: e.target.value });
              }}
            >
              <option value="all">All evidence groups</option>
              <option value="history">History-based estimates</option>
              <option value="baseline">Full-window baselines</option>
              <option value="partial">Partial fee windows</option>
              <option value="unavailable">Unavailable estimates</option>
            </select>
            <button
              className={starred ? "button filter selected" : "button filter"}
              aria-pressed={starred}
              onClick={() => {
                filter({ starred: !starred });
              }}
            >
              ☆ Watchlist <span>{watch.length}</span>
            </button>
          </div>
          {(search || chain !== "all" || starred || evidence !== "all") && (
            <button className="clear-filters" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className="market-view-bar">
          <span className="mobile-ranking-note">
            {comparableCount === 0
              ? "Earnings unavailable · inspect pool rewards"
              : personalSort
                ? "Ranked within evidence groups"
                : "Pool rewards are shared totals"}
            <MetricHelp
              label="How pools are ranked"
              text={
                personalSort
                  ? "History-based estimates are ranked first, followed by full-window baselines. Partial or unavailable estimates follow without an earnings rank. These groups describe the available evidence, not a guarantee that every history-based pool is better."
                  : "Pool rewards are shared by all allocators. Switch to an earnings sort to account for your allocation size."
              }
            />
          </span>
          <p>
            {personalSort
              ? "Sorted within evidence groups: history-based estimates, then full-window baselines. Partial or unavailable estimates follow without an earnings rank."
              : "Pool rewards are shared totals. Use earnings sorts to account for your allocation size."}
            {comparableCount === 0 && (
              <>
                {" "}
                <b>No comparable 48h earnings yet.</b> Check fee windows or use
                pool-wide rewards to shortlist.
              </>
            )}
            {comparableCount === 0 && sort !== "rewards48hUsd" && (
              <button
                className="text-link"
                onClick={() =>
                  setSorting({ key: "rewards48hUsd", descending: true })
                }
              >
                Show largest pool rewards →
              </button>
            )}
          </p>
          <div
            className="segmented"
            role="group"
            aria-label="Market table view"
          >
            <button
              aria-pressed={view === "focus"}
              className={view === "focus" ? "selected" : ""}
              onClick={() => {
                setView("focus");
                if (
                  [
                    "stakeApr",
                    "tvlUsd",
                    "volume48hUsd",
                    "aprChange",
                    "allocationChange",
                  ].includes(sort)
                ) {
                  setSorting({ key: "earnings", descending: true });
                }
              }}
            >
              Returns
            </button>
            <button
              aria-pressed={view === "all"}
              className={view === "all" ? "selected" : ""}
              onClick={() => setView("all")}
            >
              All metrics
            </button>
          </div>
        </div>
        <div className="market-cards" aria-label="Pool comparisons">
          {visible.map((r) => {
            const s = r.snapshot,
              estimate = estimates.get(s.id)!;
            return (
              <article className="market-card" key={s.id}>
                <div className="market-card-heading">
                  <button className="pool-button" onClick={() => open(r)}>
                    <Pair s={s} />
                  </button>
                  <button
                    className={`star ${watch.includes(s.id) ? "on" : ""}`}
                    aria-label={`${watch.includes(s.id) ? "Remove" : "Add"} ${s.token0.symbol}/${s.token1.symbol} ${s.chain} ${short(s.address)} ${watch.includes(s.id) ? "from" : "to"} watchlist`}
                    onClick={() =>
                      setWatch(
                        watch.includes(s.id)
                          ? watch.filter((id) => id !== s.id)
                          : [...watch, s.id],
                      )
                    }
                  >
                    {watch.includes(s.id) ? "★" : "☆"}
                  </button>
                </div>
                <div className="market-card-returns">
                  <div>
                    <Info name="earnings" label="Earnings / 48h" />
                    <button
                      className="card-earnings"
                      onClick={() => open(r, "simulator", "forecast")}
                      aria-label={`${earningsMoney(estimate.earnings)} estimated earnings over 48 hours. Simulate ${s.token0.symbol}/${s.token1.symbol} ${s.chain}`}
                    >
                      {earningsMoney(estimate.earnings)}
                    </button>
                  </div>
                  <div>
                    <Info name="stress" label="Stress / 48h" />
                    <button
                      className="card-earnings"
                      onClick={() => open(r, "simulator", "stress")}
                      aria-label={`${earningsMoney(estimate.stress)} stress earnings over 48 hours. Simulate ${s.token0.symbol}/${s.token1.symbol} ${s.chain}`}
                    >
                      {earningsMoney(estimate.stress)}
                    </button>
                  </div>
                </div>
                <div className="market-card-evidence">
                  <Badge tone={estimate.basis === "history" ? "good" : "warn"}>
                    {EVIDENCE_LABELS[estimate.basis]}
                  </Badge>
                  <span>
                    {((s.windowEnd - s.windowStart) / 3600).toFixed(1)}h fees
                    observed
                  </span>
                </div>
                {estimate.earnings === null && (
                  <p className="card-unavailable">{estimate.reason}</p>
                )}
                <div className="market-card-footer">
                  <span>
                    Pool rewards <b>{money(s.rewards48hUsd)}</b> · shared total
                  </span>
                  <button className="text-link" onClick={() => open(r)}>
                    Analyze →
                  </button>
                </div>
              </article>
            );
          })}
          {!filtered.length && (
            <div className="empty compact">
              <h3>No pools match these filters.</h3>
              <p>Try token and network terms together, such as USDC Base.</p>
              <button className="button secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
        </div>
        <div
          className="table-scroll market-scroll"
          ref={(node) => {
            if (node) {
              node.scrollTop = scrollMemory.current.top;
              node.scrollLeft = scrollMemory.current.left;
            }
          }}
          onScroll={(event) => {
            scrollMemory.current = {
              top: event.currentTarget.scrollTop,
              left: event.currentTarget.scrollLeft,
            };
          }}
          tabIndex={0}
          role="region"
          aria-label="Pool comparison table; scroll horizontally for more metrics"
        >
          <table
            className={`markets-table ${view === "focus" ? "focus-view" : ""}`}
          >
            <thead>
              <tr>
                <th className="star-col" aria-label="Watchlist" />
                {columns.map(([key, label]) => (
                  <th
                    key={key}
                    className={
                      [
                        "stakeApr",
                        "tvlUsd",
                        "volume48hUsd",
                        "aprChange",
                        "allocationChange",
                      ].includes(key)
                        ? "extra-metric"
                        : undefined
                    }
                    aria-sort={
                      sort === key
                        ? desc
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    {key === "evidence" ? (
                      <Info name={key} label={label} />
                    ) : (
                      <span className="sortable-metric">
                        <button onClick={() => sortBy(key)}>
                          {label}
                          {sort === key ? (
                            <span className="sort-active">
                              {desc ? "↓" : "↑"}
                            </span>
                          ) : null}
                        </button>
                        <MetricHelp label={label} text={metricInfo[key]} />
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const s = r.snapshot;
                const estimate = estimates.get(s.id)!;
                return (
                  <tr key={s.id} className={!s.active ? "inactive" : ""}>
                    <td className="star-col">
                      <button
                        className={`star ${watch.includes(s.id) ? "on" : ""}`}
                        aria-label={`${watch.includes(s.id) ? "Remove" : "Add"} ${s.token0.symbol}/${s.token1.symbol} ${short(s.address)} ${watch.includes(s.id) ? "from" : "to"} watchlist`}
                        onClick={() =>
                          setWatch(
                            watch.includes(s.id)
                              ? watch.filter((x) => x !== s.id)
                              : [...watch, s.id],
                          )
                        }
                      >
                        {watch.includes(s.id) ? "★" : "☆"}
                      </button>
                    </td>
                    <td>
                      <button className="pool-button" onClick={() => open(r)}>
                        <Pair s={s} />
                      </button>
                      {!s.active && <Badge tone="warn">Inactive</Badge>}
                      {!isFresh(s, now) && (
                        <Badge tone="warn">Stale observation</Badge>
                      )}
                    </td>
                    <td
                      className="emphasis personal-earnings"
                      title={estimate.reason}
                    >
                      <button
                        className="metric-button"
                        onClick={() => open(r, "simulator")}
                        aria-label={`${earningsMoney(estimate.earnings)} estimated earnings over 48 hours. Simulate ${s.token0.symbol}/${s.token1.symbol} ${s.chain} allocation`}
                      >
                        {earningsMoney(estimate.earnings)}
                      </button>
                      <small>
                        {estimate.basis === "baseline"
                          ? "Baseline"
                          : estimate.basis === "history"
                            ? "Modeled estimate"
                            : estimate.basis === "partial"
                              ? "Needs full fee window"
                              : estimate.reason}
                      </small>
                    </td>
                    <td className="personal-stress" title={metricInfo.stress}>
                      <button
                        className="metric-button"
                        onClick={() => open(r, "simulator", "stress")}
                        aria-label={`${earningsMoney(estimate.stress)} stress earnings over 48 hours. Simulate ${s.token0.symbol}/${s.token1.symbol} ${s.chain} allocation`}
                      >
                        {earningsMoney(estimate.stress)}
                      </button>
                      <small>−50% fees · +50% competition</small>
                    </td>
                    <td className="evidence-cell" title={estimate.reason}>
                      <Badge
                        tone={estimate.basis === "history" ? "good" : "warn"}
                      >
                        {EVIDENCE_LABELS[estimate.basis]}
                      </Badge>
                      <small>
                        {((s.windowEnd - s.windowStart) / 3600).toFixed(1)}h
                        fees observed
                      </small>
                    </td>
                    <td className="emphasis">
                      {money(s.rewards48hUsd)}
                      <small>shared by all allocators</small>
                    </td>
                    <td>
                      {money(s.eligibleFees48hUsd)}
                      <small
                        className={
                          s.windowEnd - s.windowStart < 47 * 3600
                            ? "partial-window"
                            : ""
                        }
                      >
                        {Math.max(
                          0,
                          (s.windowEnd - s.windowStart) / 3600,
                        ).toFixed(1)}
                        h observed · est.
                      </small>
                    </td>
                    <td>
                      {money(s.incentives48hUsd)}
                      <small>
                        {s.programs?.filter(
                          (p) =>
                            p.end > s.observedAt &&
                            p.start < s.observedAt + HORIZON,
                        ).length ?? "—"}{" "}
                        programs · est.
                      </small>
                    </td>
                    <td>
                      {number(s.allocation, true)}
                      <small>reward supply</small>
                    </td>
                    <td className="apr extra-metric">
                      <button
                        className="metric-button"
                        title={metricInfo.stakeApr}
                        onClick={() => open(r, "simulator")}
                      >
                        {pct(s.stakeApr)}
                      </button>
                      <small>power APR · est.</small>
                    </td>
                    <td className="extra-metric">{money(s.tvlUsd, true)}</td>
                    <td className="extra-metric">
                      {money(s.volume48hUsd, true)}
                      <small>
                        {Math.max(
                          0,
                          (s.windowEnd - s.windowStart) / 3600,
                        ).toFixed(1)}
                        h observed
                      </small>
                    </td>
                    <td
                      className={`extra-metric ${r.aprChange === null ? "" : r.aprChange >= 0 ? "positive" : "negative"}`}
                    >
                      {r.aprChange === null
                        ? "—"
                        : `${r.aprChange >= 0 ? "+" : ""}${r.aprChange.toFixed(2)} pp`}
                    </td>
                    <td
                      className={`extra-metric ${r.allocationChange !== null && r.allocationChange > 10 ? "negative" : ""}`}
                    >
                      {r.allocationChange === null
                        ? "—"
                        : `${r.allocationChange >= 0 ? "+" : ""}${r.allocationChange.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty compact">
              <h3>
                {starred
                  ? "No watched pools match these filters."
                  : "No pools match these filters."}
              </h3>
              <p>
                {starred && watch.length === 0
                  ? "Add pools with the star beside their name to build your watchlist."
                  : "Try a token symbol, network name or pool address."}
              </p>
              <button className="button secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            {filtered.length ? currentPage * 25 + 1 : 0}–
            {Math.min((currentPage + 1) * 25, filtered.length)} of{" "}
            {filtered.length} pools{" "}
            <span className="muted">· — means unavailable</span>
          </span>
          <div>
            <button
              disabled={currentPage === 0}
              onClick={() => turnPage(currentPage - 1)}
              aria-label="Previous page"
            >
              ←
            </button>
            <span>
              {currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}
            </span>
            <button
              disabled={(currentPage + 1) * 25 >= filtered.length}
              onClick={() => turnPage(currentPage + 1)}
              aria-label="Next page"
            >
              →
            </button>
          </div>
        </div>
      </section>
      <div className="insight-strip">
        <span>⌁</span>
        <div>
          <b>A high APR is a starting point.</b>
          <p>
            Check incentive expiry, source-window length and incoming
            allocation.{" "}
            {partialWindows > 0
              ? "Short fee windows are preserved as observed; they are not scaled into a full 48 hours."
              : "Use the simulator to compare earnings after your own allocation."}
          </p>
        </div>
        <button disabled={!filtered[0]} onClick={() => open(filtered[0])}>
          Inspect a pool →
        </button>
      </div>
    </>
  );
}
function Stat({
  label,
  value,
  detail,
  highlight = false,
}: {
  label: string;
  value: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <div className={`stat ${highlight ? "highlight" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Opportunities({
  screen: initialScreen,
  rows,
  compareWith,
  selectForSplit,
  openSplit,
  estimates,
  power,
  open,
  browse,
}: {
  screen: ReturnType<typeof shortlist>;
  rows: MarketRow[];
  compareWith: string;
  selectForSplit: (id: string) => void;
  openSplit: (first: MarketRow, second: MarketRow) => void;
  estimates: Map<string, EarningsComparison>;
  power: string;
  open: (row: MarketRow, page?: Page, scenario?: ScenarioBasis) => void;
  browse: () => void;
}) {
  const choosing = compareWith !== "";
  const choosingSecond = choosing && compareWith !== "choose";
  const first = choosingSecond
    ? rows.find((r) => r.snapshot.id === compareWith)
    : undefined;
  const firstEstimate = first && estimates.get(first.snapshot.id);
  const firstUsable =
    !!firstEstimate &&
    firstEstimate.earnings !== null &&
    firstEstimate.stress !== null;
  const screen = useMemo(() => {
    if (!choosingSecond) return initialScreen;
    const compatible =
      first && firstUsable
        ? rows.filter((row) => !splitCompatibilityError(first, row))
        : [];
    return shortlist(compatible, estimates, "all");
  }, [initialScreen, choosingSecond, first, firstUsable, rows, estimates]);
  const choose = (row: MarketRow) => {
    if (first && firstUsable) openSplit(first, row);
    else selectForSplit(row.snapshot.id);
  };
  const ranked = screen.qualified > 0;
  const count = ranked ? screen.qualified : screen.baselines;
  const invalidPower =
    power.trim() !== "" &&
    !(Number(power) > 0 && Number.isFinite(Number(power)));
  return (
    <section className="panel shortlist">
      <div className="panel-header">
        <div>
          <h2>
            {choosing
              ? choosingSecond
                ? "Choose the second pool"
                : "Choose the first pool"
              : ranked
                ? "Ranked shortlist"
                : count
                  ? "Full-window baselines"
                  : "Pool shortlist"}
          </h2>
          <p>
            {choosingSecond ? (
              first ? (
                <>
                  Pair with{" "}
                  <b>
                    {first.snapshot.token0.symbol}/
                    {first.snapshot.token1.symbol}
                  </b>{" "}
                  · {first.snapshot.chain} · {short(first.snapshot.address)}.
                  Both pools must share a forecast window.
                </>
              ) : (
                "The first pool is unavailable in this dataset."
              )
            ) : choosing ? (
              "Choose one pool, then a second on the same network to test a split."
            ) : ranked ? (
              `${count} of ${screen.tracked} tracked pools qualify. Showing the top ${screen.visible.length} by stress earnings.`
            ) : count ? (
              `Showing ${screen.visible.length} of ${count} baselines by estimated earnings. No pool in this selection qualifies for a history-based ranking.`
            ) : (
              `${screen.tracked} tracked pools in this network selection.`
            )}
          </p>
        </div>
        <div className="shortlist-actions">
          {choosing ? (
            <>
              {choosingSecond && (
                <button
                  className="text-link"
                  onClick={() => selectForSplit("choose")}
                >
                  Change first pool
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => selectForSplit("")}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {count > 0 && (
                <button
                  className="button secondary"
                  onClick={() => selectForSplit("choose")}
                >
                  Compare two pools
                </button>
              )}
              <button className="text-link" onClick={browse}>
                Browse Markets →
              </button>
            </>
          )}
        </div>
      </div>
      {!choosing && (
        <details className="shortlist-method">
          <summary>How are these pools chosen?</summary>
          <p>
            Markets includes pools from the configured Aero registries that have
            a gauge and a rewards manager. Inactive pools remain visible in the
            directory.
          </p>
          <p>
            For this shortlist, each pool needs an active gauge, a current
            observation, a 47–49 hour fee window and enough priced inputs to
            estimate your share. A history-based ranking also requires at least
            47½ hours of history, 80 priced fee observations and no gap over 75
            minutes.
          </p>
          <p>
            Each row puts your total power into that pool immediately and holds
            it constant for 48 hours. Earnings use your share of projected
            revenue after dilution. Simulator also lets you test timing, decay
            and a two-pool split.
          </p>
          <p>
            History-qualified pools are ordered by modeled earnings after
            forecast fees fall 50% and projected competing power rises 50%.
            Scheduled incentives keep their modeled value through expiry. When
            only baselines are available, the list orders them by estimated
            earnings under current conditions.
          </p>
        </details>
      )}
      {screen.visible.length > 0 && (
        <div className="shortlist-hint">
          {ranked
            ? "Stress models 50% lower fees and 50% more competing power."
            : "Baselines hold current fees and competing power steady. Their persistence is untested."}{" "}
          {choosing
            ? ranked
              ? "History-based estimates."
              : "Full-window baselines."
            : "Open an amount to simulate it."}
        </div>
      )}
      <ol
        className="shortlist-rows"
        aria-label={
          ranked
            ? "Pools ranked by stress earnings"
            : "Baseline pool comparisons"
        }
      >
        {screen.visible.map((row, index) => {
          const s = row.snapshot;
          const e = estimates.get(s.id)!;
          const metrics = ranked
            ? (["stress", "earnings"] as const)
            : (["earnings", "stress"] as const);
          return (
            <li key={s.id}>
              <span className="shortlist-position" aria-hidden="true">
                {index + 1}
              </span>
              <button
                className="pool-button"
                onClick={() => (choosing ? choose(row) : open(row))}
                title={
                  choosing ? "Select pool for comparison" : "Open pool analysis"
                }
              >
                <Pair s={s} />
              </button>
              {metrics.map((metric) =>
                choosing ? (
                  <div key={metric} className="shortlist-metric">
                    <span>
                      {metric === "stress" ? "Stress / 48h" : "Estimate / 48h"}
                    </span>
                    <strong>{earningsMoney(e[metric])}</strong>
                  </div>
                ) : (
                  <button
                    key={metric}
                    className="shortlist-metric"
                    onClick={() =>
                      open(
                        row,
                        "simulator",
                        metric === "stress" ? "stress" : "forecast",
                      )
                    }
                    aria-label={`Simulate ${metric === "stress" ? "stress" : "estimated"} earnings for ${s.token0.symbol}/${s.token1.symbol} on ${s.chain} ${short(s.address)}`}
                  >
                    <span>
                      {metric === "stress" ? "Stress / 48h" : "Estimate / 48h"}
                    </span>
                    <strong>{earningsMoney(e[metric])}</strong>
                  </button>
                ),
              )}
              <div className="shortlist-signals">
                <span>
                  Incentives ·{" "}
                  {
                    row.forecast.signals.find(
                      (signal) => signal.name === "Incentive runway",
                    )?.value
                  }
                </span>
                <small>
                  Allocation{" "}
                  {row.forecast.signals.find(
                    (signal) => signal.name === "Allocation pressure",
                  )?.value ?? "—"}
                </small>
              </div>
              <button
                className="button secondary inspect-pool"
                onClick={() => (choosing ? choose(row) : open(row))}
              >
                {choosing
                  ? choosingSecond
                    ? "Test split →"
                    : "Select"
                  : "Analyze →"}
              </button>
            </li>
          );
        })}
      </ol>
      {!count && (
        <div className="empty compact">
          <h3>
            {choosingSecond
              ? "No compatible second pool"
              : invalidPower
                ? "Enter a positive allocation power"
                : "No comparable pools for this selection"}
          </h3>
          <p>
            {choosingSecond
              ? first && !firstUsable
                ? "The first pool no longer has comparable earnings for this power. Choose another first pool or adjust the allocation."
                : "Choose a different first pool to compare the same forecast period on its network."
              : invalidPower
                ? "Clear the amount to try 1,000 reference power."
                : "Open Markets to see individual fee windows, freshness and missing estimates, or choose another network."}
          </p>
        </div>
      )}
    </section>
  );
}
function Analysis({
  row,
  rows,
  select,
  watch,
  mode,
  revision,
  simulate: goSim,
}: {
  row: MarketRow;
  rows: MarketRow[];
  select: (s: string) => void;
  watch: string[];
  mode: Mode;
  revision: number;
  simulate: () => void;
}) {
  const [days, setDays] = useState(2);
  const s = row.snapshot;
  const chartKey = `${mode}:${s.id}:${days}`;
  const [series, setSeries] = useState<{
    key: string;
    points: HistoryPoint[];
  } | null>(null);
  const [historyError, setHistoryError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const error = historyError?.key === chartKey ? historyError.message : "";
  const historyLoaded = series?.key === chartKey;
  const windowEnd =
    mode === "demo" ? s.observedAt : Math.floor(Date.now() / 1000);
  const since = windowEnd - days * 86400;
  const history = historyLoaded
    ? series.points.filter(
        (p) => p.observedAt >= since && p.observedAt <= windowEnd,
      )
    : [];
  useEffect(() => {
    const abort = new AbortController();
    setHistoryError(null);
    get<HistoryPoint[]>(
      `/api/history?mode=${mode}&pool=${s.id}&days=${days}`,
      abort.signal,
    )
      .then((points) => {
        if (!abort.signal.aborted) setSeries({ key: chartKey, points });
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setHistoryError({ key: chartKey, message: e.message });
      });
    return () => abort.abort();
  }, [
    chartKey,
    s.id,
    s.observedAt,
    s.retrievedAt,
    s.blockHash,
    mode,
    days,
    revision,
  ]);
  const charts: [keyof HistoryPoint, string, string][] = [
    ["stakeApr", "Stake APR", "% · estimate"],
    ["rewards48hUsd", "Pool rewards · next 48h", "USD · estimate"],
    ["allocation", "Allocation power", "observed reward supply"],
    ["volume48hUsd", "Trading volume", "USD · trailing source window"],
    [
      "eligibleFees48hUsd",
      "Eligible fee revenue",
      "USD · eligibility estimate",
    ],
    ["incentives48hUsd", "Scheduled incentives", "USD · next 48h estimate"],
  ];
  const events = history
    .flatMap((v, i) => {
      const p = history[i - 1];
      if (!p) return [];
      const e: string[] = [];
      if (
        p.stakeApr !== null &&
        p.stakeApr > 0 &&
        v.stakeApr !== null &&
        v.stakeApr / p.stakeApr > 1.5
      )
        e.push("APR increased more than 50%");
      if (
        p.allocation !== null &&
        p.allocation > 0 &&
        v.allocation !== null &&
        v.allocation / p.allocation > 1.2
      )
        e.push("Allocation power increased more than 20%");
      if (
        p.eligibleFees48hUsd !== null &&
        p.eligibleFees48hUsd > 0 &&
        v.eligibleFees48hUsd !== null &&
        Math.abs(v.eligibleFees48hUsd / p.eligibleFees48hUsd - 1) > 0.5
      )
        e.push("Eligible fee estimate changed more than 50%");
      return e.map((label) => ({ at: v.observedAt, label }));
    })
    .reverse()
    .slice(0, 8);
  return (
    <>
      <div className="pool-selection">
        <PoolPicker row={row} rows={rows} select={select} watch={watch} />
        <button className="button primary" onClick={goSim}>
          Simulate allocation →
        </button>
      </div>
      <section className="panel pool-summary">
        <Pair s={s} />
        <div>
          <span className="small-label">Pool identity</span>
          <code title={s.id}>{s.id}</code>
        </div>
        <div>
          <span className="small-label">Source block</span>
          <b>{s.block}</b>
        </div>
        <Badge tone={row.forecast.basis === "history" ? "good" : "warn"}>
          {row.forecast.basis === "history"
            ? "History available"
            : "Insufficient history"}
        </Badge>
      </section>
      <div className="stat-grid">
        <Stat
          label="Stake APR · estimate"
          value={pct(s.stakeApr)}
          detail="Uses allocation power value"
        />
        <Stat
          label="Pool rewards · next 48h"
          value={money(s.rewards48hUsd)}
          detail="Shared by all allocators"
        />
        <Stat
          label="Current reward supply"
          value={number(s.allocation, true)}
          detail="Decayed allocation power"
        />
        <Stat
          label="Configured cooldown"
          value={s.cooldownHours === null ? "—" : `${s.cooldownHours} hours`}
          detail="Per stake and network"
        />
      </div>
      <PoolCoverage row={row} />
      <div className="section-line">
        <div>
          <h2>Observation history</h2>
          <p>
            {history.length
              ? `${history.length} snapshots · ${date(history[0].observedAt)} onward`
              : error
                ? "History could not be loaded"
                : historyLoaded
                  ? "No observations in the selected period"
                  : "Loading observation history…"}
            {mode === "demo" && ` · Fixture window ends ${date(s.observedAt)}`}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="History range">
          {[
            [1, "24h"],
            [2, "48h"],
            [7, "7d"],
            [30, "30d"],
          ].map(([n, label]) => (
            <button
              className={days === n ? "selected" : ""}
              key={n}
              onClick={() => setDays(Number(n))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="notice danger">{error}</div>}
      <ChartBoundary>
        <div className="chart-grid">
          {charts.map(([key, label, unit]) => (
            <div className="panel chart-card" key={key}>
              <div className="chart-heading">
                <h3>
                  <Info name={key} label={label} />
                </h3>
                <span>{unit}</span>
              </div>
              {history.some((s) => s[key] !== null) ? (
                <>
                  <div className="chart">
                    <React.Suspense
                      fallback={
                        <span className="chart-empty">Loading chart…</span>
                      }
                    >
                      <HistoryChart
                        history={history}
                        metric={key}
                        label={label}
                        days={days}
                      />
                    </React.Suspense>
                  </div>
                  {history.length < 2 && (
                    <div className="chart-caption">
                      First observation saved. A trend needs more snapshots.
                    </div>
                  )}
                  {(key === "stakeApr" || key === "allocation") &&
                    history.length >= 2 && (
                      <div className="chart-caption">
                        Vertical axis follows the observed range to make changes
                        visible.
                      </div>
                    )}
                </>
              ) : (
                <div className="chart-empty">
                  {historyLoaded
                    ? "No supported observations in this window."
                    : error
                      ? "History unavailable."
                      : "Loading observations…"}
                </div>
              )}
            </div>
          ))}
        </div>
      </ChartBoundary>
      <div className="section-line">
        <div>
          <h2>Persistence signals</h2>
          <p>
            Every signal has an explicit interpretation. None is a probability.
          </p>
        </div>
      </div>
      <div className="signals-grid">
        {row.forecast.signals.map((signal) => (
          <div className="panel signal" key={signal.name}>
            <span className="small-label">{signal.name}</span>
            <b className={signal.severity === "warn" ? "warning-text" : ""}>
              {signal.value}
            </b>
            <p>{signal.detail}</p>
          </div>
        ))}
      </div>
      <div className="method-grid">
        <div className="panel text-panel">
          <h3>Changes worth investigating</h3>
          {row.forecast.basis === "insufficient" && (
            <div className="event">
              <Badge tone="warn">New history</Badge>
              <span>Insufficient history to establish APR persistence.</span>
            </div>
          )}
          {events.map((e, i) => (
            <div className="event" key={i}>
              <small>{date(e.at)}</small>
              <span>{e.label}</span>
            </div>
          ))}
          {!events.length && (
            <p>No threshold changes detected in the available observations.</p>
          )}
        </div>
        <div className="panel text-panel">
          <h3>Incentive schedule</h3>
          {s.programs === null ? (
            <p>Schedule unavailable.</p>
          ) : (
            s.programs
              .filter(
                (p) => p.end > s.observedAt && p.start < s.observedAt + HORIZON,
              )
              .map((p) => (
                <div className="program" key={p.id}>
                  <b>
                    {p.token.symbol} <small>#{p.id}</small>
                  </b>
                  <span>
                    {money(
                      incentives([p], s.observedAt, s.observedAt + HORIZON),
                    )}{" "}
                    / next 48h
                  </span>
                  <small>
                    Starts {date(p.start)}
                    <br />
                    Ends {date(p.end)}
                  </small>
                  {p.end < s.observedAt + HORIZON && (
                    <Badge tone="warn">Expires within forecast</Badge>
                  )}
                </div>
              ))
          )}
          {s.programs?.length === 0 && (
            <p>No incentive programs returned by the rewards contract.</p>
          )}
        </div>
      </div>
      <details className="panel assumptions">
        <summary>
          Source limitations and assumptions ({s.warnings.length})
        </summary>
        {s.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <p>
          Source activity window: {date(s.windowStart)} → {date(s.windowEnd)}.
          Observed at {date(s.observedAt)}. Block hash:{" "}
          <code>{s.blockHash}</code>.
        </p>
      </details>
    </>
  );
}
function Simulator({
  row,
  compareWith,
  selectSecond,
  rows,
  select,
  watch,
  allocationSettings,
  now,
  basis,
  setBasis,
}: {
  row: MarketRow;
  compareWith: string;
  selectSecond: (id: string) => void;
  rows: MarketRow[];
  select: (s: string) => void;
  watch: string[];
  allocationSettings: AllocationSettings;
  now: number;
  basis: ScenarioBasis;
  setBasis: (basis: ScenarioBasis) => void;
}) {
  const [fields, setFields] = useLocal<Record<string, string>>("gc-simulator", {
    power: "1000",
    existingPower: "0",
    stakeValueUsd: "",
    remainingDays: "",
    activationDelayHours: "0",
  });
  const input: SimulationInput = {
    power:
      allocationSettings.power.trim() === ""
        ? 1000
        : Number(allocationSettings.power),
    existingPower:
      allocationSettings.power.trim() === ""
        ? 0
        : Number(allocationSettings.existing[positionKey(row.snapshot)] ?? "0"),
    stakeValueUsd:
      fields.stakeValueUsd === "" ? null : Number(fields.stakeValueUsd),
    remainingDays:
      fields.remainingDays === "" ? null : Number(fields.remainingDays),
    activationDelayHours: Number(fields.activationDelayHours),
  };
  const marketEstimate = comparison(row, allocationSettings, now);
  const customTiming =
    input.activationDelayHours !== 0 || input.remainingDays !== null;
  const outputs = SCENARIOS.map((s) => ({
    ...s,
    ...simulateAllocation(row, input, basis, s, now),
  }));
  return (
    <>
      <div className="pool-selection">
        <PoolPicker row={row} rows={rows} select={select} watch={watch} />
        <Badge>Inputs stay in this browser</Badge>
      </div>
      <SplitComparison
        key={positionKey(row.snapshot)}
        secondId={compareWith}
        selectSecond={selectSecond}
        row={row}
        rows={rows}
        watch={watch}
        input={input}
        basis={basis}
        now={now}
        allocationSettings={allocationSettings}
      />
      <div className="simulator-layout">
        <section className="panel simulator-inputs">
          <h2>Your allocation</h2>
          <p>
            Power is shared with Markets and Opportunities. Existing allocation
            is saved separately for each pool.
          </p>
          <label className="field">
            <span>Starting scenario</span>
            <select
              value={basis}
              onChange={(e) => setBasis(e.target.value as ScenarioBasis)}
            >
              <option value="forecast">
                Markets estimate · projected competition
              </option>
              <option value="stress">
                Markets stress · lower fees, more competition
              </option>
              <option value="current">
                Current competition · fixed baseline
              </option>
            </select>
            <small>
              {basis === "stress"
                ? "Forecast fees −50%, projected other power +50%. Scheduled incentive value is unchanged."
                : basis === "forecast"
                  ? "Uses the same projected competing power and revenue as Markets."
                  : "Holds competing power at the current observation; forecast fees and incentive schedules still apply."}
            </small>
          </label>
          {allocationSettings.power.trim() === "" && (
            <p className="simulation-reference">
              Reference scenario: 1,000 additional power. Enter your intended
              total to use existing allocation.
            </p>
          )}
          {fields.existingPower &&
            fields.existingPower !== "0" &&
            allocationSettings.existing[positionKey(row.snapshot)] ===
              undefined && (
              <p className="simulation-reference">
                Re-enter any existing power for this pool. The previous shared
                value is no longer applied across pools.
              </p>
            )}
          {[
            [
              "power",
              "Allocation power",
              "Total power you intend to direct to this pool.",
            ],
            [
              "existingPower",
              "Already allocated to this pool",
              "Power already included in the current pool total; subtract it before adding your intended allocation.",
            ],
            [
              "stakeValueUsd",
              "Stake value in USD · optional",
              "Your capital denominator for personal APR. Blank means APR is unavailable.",
            ],
            [
              "remainingDays",
              "Fixed stake remaining days · optional",
              "Blank models a perpetual stake. A fixed stake’s power decays linearly to zero.",
            ],
            [
              "activationDelayHours",
              "Activation delay in hours",
              "Earnings begin after the assumed delay, within the 48-hour horizon.",
            ],
          ].map(([key, label, help]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                min="0"
                step="any"
                max={key === "activationDelayHours" ? 48 : undefined}
                placeholder={key === "power" ? "1,000 reference" : undefined}
                disabled={
                  key === "existingPower" &&
                  allocationSettings.power.trim() === ""
                }
                value={
                  key === "power"
                    ? allocationSettings.power
                    : key === "existingPower"
                      ? (allocationSettings.existing[
                          positionKey(row.snapshot)
                        ] ?? "0")
                      : fields[key]
                }
                onChange={(e) => {
                  if (key === "power")
                    allocationSettings.setPower(e.target.value);
                  else if (key === "existingPower")
                    allocationSettings.setExisting({
                      ...allocationSettings.existing,
                      [positionKey(row.snapshot)]: e.target.value,
                    });
                  else setFields({ ...fields, [key]: e.target.value });
                }}
              />
              <small>{help}</small>
            </label>
          ))}
          <div className="privacy-note">
            ⌂ Saved only in local browser storage.
          </div>
        </section>
        <div>
          <section className="panel sim-result">
            <div className="panel-header">
              <Pair s={row.snapshot} />
              <Badge tone="warn">Hypothetical</Badge>
            </div>
            <div className="earnings">
              <span>
                {SCENARIO_LABELS[basis]}
                {customTiming ? " with your timing" : ""} · next 48 hours
              </span>
              <strong>{earningsMoney(outputs[0].earnings)}</strong>
              <p>
                {outputs[0].error ??
                  `${pct(outputs[0].share === null ? null : outputs[0].share * 100)} initial share after your allocation`}
              </p>
              {marketEstimate.earnings !== null && customTiming ? (
                <p className="market-estimate-note">
                  Saved timing and stake decay are applied. Markets assumes
                  immediate allocation and constant power (
                  {earningsMoney(
                    basis === "stress"
                      ? marketEstimate.stress
                      : marketEstimate.earnings,
                  )}
                  {basis === "stress" ? " stress" : " estimate"}).{" "}
                  <button
                    className="text-link"
                    onClick={() =>
                      setFields({
                        ...fields,
                        activationDelayHours: "0",
                        remainingDays: "",
                      })
                    }
                  >
                    Use immediate, constant power
                  </button>
                </p>
              ) : marketEstimate.earnings === null ? (
                <p className="market-estimate-note">
                  Comparable earnings are unavailable: {marketEstimate.reason}.
                </p>
              ) : (
                <p className="market-estimate-note">
                  Immediate allocation, constant own power.{" "}
                  {basis === "current"
                    ? "Current competition is an alternative assumption."
                    : "Matches the selected Markets figure."}
                </p>
              )}
            </div>
            <div className="sim-facts">
              <div>
                <span>Personal capital APR</span>
                <b>{pct(outputs[0].apr)}</b>
                <small>
                  {input.stakeValueUsd === null
                    ? "Enter stake value to calculate"
                    : "Annualized, without compounding"}
                </small>
              </div>
              <div>
                <span>Pool eligible fee forecast</span>
                <b>
                  {money(
                    row.forecast.projectedFees === null
                      ? null
                      : row.forecast.projectedFees *
                          (basis === "stress" ? 0.5 : 1),
                  )}
                </b>
                <small>
                  {row.forecast.basis === "history"
                    ? basis === "stress"
                      ? "History forecast reduced by 50%"
                      : "Conservative history heuristic"
                    : "Current baseline · insufficient history"}
                </small>
              </div>
              <div>
                <span>Scheduled pool incentives</span>
                <b>{money(row.forecast.projectedIncentives)}</b>
                <small>Stops at program expiry</small>
              </div>
            </div>
          </section>
          <section className="panel scenario-panel">
            <div className="panel-header">
              <div>
                <h2>What changes your return?</h2>
                <p>
                  Additional shocks apply to the selected starting scenario.
                  Your timing inputs apply to every row.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Your earnings / 48h</th>
                    <th>Capital APR</th>
                    <th>vs. starting scenario</th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.map((s, i) => (
                    <tr key={s.label}>
                      <td>
                        {i === 0 ? SCENARIO_LABELS[basis] : s.label}
                        {i === 0 && <small>Selected starting scenario</small>}
                      </td>
                      <td className="emphasis">{earningsMoney(s.earnings)}</td>
                      <td>{pct(s.apr)}</td>
                      <td className={i === 0 ? "" : "negative"}>
                        {s.earnings === null ||
                        outputs[0].earnings === null ||
                        outputs[0].earnings === 0
                          ? "—"
                          : `${((s.earnings / outputs[0].earnings - 1) * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="panel text-panel formula">
            <span className="eyebrow">THE MODEL</span>
            <h3>Your share × revenue, integrated over time</h3>
            <code>
              share(t) = your power(t) / [other power(t) + your power(t)]
            </code>
            <p>
              Fees use a constant rate over the forecast window. Incentives use
              actual program times. Optional stake decay and activation delay
              change your share. The revenue-down scenario halves all USD
              revenue, including incentive token value.
            </p>
            <p>
              Markets estimate and Markets stress use the same projected
              competing power and forecast cutoff as the comparison you opened.
              Current competition is an explicit alternative. Timing and stake
              decay can change your result; the selected starting scenario is
              included in the link, while personal inputs stay on your device.
            </p>
            <p>
              Competition scenarios hold other power constant after the
              immediate shock. They do not include endogenous liquidity changes,
              price moves, bridging fees, gas, or exact contract rounding. These
              are estimates, not claimable balances.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
interface PerformanceData {
  evaluations: Evaluation[];
  decisions: { at: number; choices: Record<string, string | null> }[];
  scope: string;
  totalStored: number;
}
function Performance({
  mode,
  rows,
  revision,
}: {
  mode: Mode;
  rows: MarketRow[];
  revision: string;
}) {
  const [data, setData] = useState<PerformanceData | null>(null),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    get<PerformanceData>(`/api/performance?mode=${mode}`, abort.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [mode, revision]);
  if (error) return <div className="notice danger">{error}</div>;
  if (!data)
    return <div className="loading">Evaluating stored forecast windows…</div>;
  const done = data.evaluations.filter((e) => e.status === "proxy"),
    pending = data.evaluations.filter((e) => e.status === "pending");
  const summary = performanceSummary(data.evaluations, data.decisions);
  const mean = (key: "revenueError" | "returnError") => {
    const a = done.flatMap((e) => (e[key] === null ? [] : [e[key]!]));
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  };
  const { byId, paired, cohorts, counts } = summary;
  const pools = new Map(rows.map((r) => [r.snapshot.id, r.snapshot]));
  const priority = { proxy: 0, insufficient: 1, pending: 2 };
  const ledger = data.evaluations
    .filter((e) => filter === "all" || e.status === filter)
    .sort(
      (a, b) => priority[a.status] - priority[b.status] || b.dueAt - a.dueAt,
    );
  const pages = Math.max(1, Math.ceil(ledger.length / 25));
  const currentPage = Math.min(page, pages - 1);
  return (
    <>
      <PairwiseBenchmarks
        comparisons={summary.comparisons}
        total={data.decisions.length}
      />
      <div className="stat-grid">
        <Stat
          label="Forecasts in this view"
          value={number(data.evaluations.length)}
          detail={`${number(data.totalStored)} frozen forecasts stored overall`}
        />
        <Stat
          label="Evaluated in this view"
          value={number(done.length)}
          detail={`${number(counts.proxy + counts.insufficient)} mature windows in this sample`}
        />
        <Stat
          label="Revenue mean absolute error"
          value={money(mean("revenueError"))}
          detail="Evaluated sample · observed-window proxy"
        />
        <Stat
          label="Return mean absolute error"
          value={money(mean("returnError"))}
          detail="Evaluated sample · USD / 1,000 additional power"
        />
      </div>
      <div className="performance-scope">
        <b>This page shows a sample of the forecast archive.</b>
        <p>
          {number(counts.proxy)} evaluated · {number(counts.pending)} awaiting
          48h · {number(counts.insufficient)} with incomplete observations.
          These counts and errors describe this view, not all{" "}
          {number(data.totalStored)} stored forecasts.
        </p>
        {summary.firstDue !== null && (
          <p>
            Forecast maturity range: {date(summary.firstDue)} →{" "}
            {date(summary.lastDue!)}. {data.scope}
          </p>
        )}
      </div>
      {done.length === 0 && (
        <div className="notice warning">
          <b>No completed return evaluation yet.</b> {pending.length} forecasts
          in this view are still inside their 48-hour window. Results will
          appear only after sufficient genuine observations are available.
        </div>
      )}
      <div className="notice">
        <b>Evaluation is an observed-data proxy.</b> Trailing eligible fees are
        approximated at the endpoint, fee timing is uniform, incentives use
        their actual schedules, and allocation shares use collected snapshots.
        This is not a wallet’s realized return or an event-level backtest.
        Overlapping trailing windows are never summed.
      </div>
      <details className="panel benchmark-four">
        <summary>
          All four rules on the same windows · {paired.length} of{" "}
          {data.decisions.length} matched
        </summary>
        <div className="benchmark-coverage">
          <b>
            {paired.length} of {data.decisions.length} selection groups can be
            compared across all four rules.
          </b>
          <p>
            A group needs a saved choice and a completed return proxy for every
            rule at the same collection time.
          </p>
          {paired.length !== data.decisions.length && (
            <ul>
              {cohorts.missingSelection > 0 && (
                <li>
                  {cohorts.missingSelection} groups lack at least one original
                  selection. The persistence rule requires enough history before
                  it can select a pool.
                </li>
              )}
              {cohorts.pending > 0 && (
                <li>
                  {cohorts.pending} groups still have a forecast awaiting its
                  48-hour window.
                </li>
              )}
              {cohorts.missingEvaluation > 0 && (
                <li>
                  {cohorts.missingEvaluation} groups have a selected forecast
                  outside the evaluations available in this view.
                </li>
              )}
              {cohorts.incomplete > 0 && (
                <li>
                  {cohorts.incomplete} groups have incomplete observations for
                  at least one selected pool.
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Selection rule</th>
                <th>Completed selections</th>
                <th>Mean observed return proxy / 48h</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(BENCHMARK_NAMES).map(([key, label]) => {
                const e = paired.map((d) => byId.get(d.choices[key]!)!);
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{e.length}</td>
                    <td>
                      {money(
                        e.length
                          ? e.reduce((s, e) => s + e.observedReturnProxy!, 0) /
                              e.length
                          : null,
                      )}
                    </td>
                    <td>
                      {e.length
                        ? "Matched complete cohorts"
                        : "Insufficient matched history"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      <section className="panel performance-table">
        <div className="panel-header">
          <div>
            <h2>Forecast ledger</h2>
            <p>{data.scope}</p>
          </div>
          <Badge>
            {mode === "demo" ? "Synthetic evaluation" : "Observation history"}
          </Badge>
        </div>
        <div className="toolbar">
          <select
            aria-label="Forecast status"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All forecasts · evaluated first</option>
            <option value="proxy">Evaluated proxies</option>
            <option value="pending">Awaiting 48h</option>
            <option value="insufficient">Incomplete observations</option>
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Pool / maturity (UTC)</th>
                <th>Revenue forecast → proxy</th>
                <th>Revenue error</th>
                <th>Allocation forecast → observed</th>
                <th>Allocation error</th>
                <th>Return forecast → proxy</th>
                <th>Return error</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ledger
                .slice(currentPage * 25, (currentPage + 1) * 25)
                .map((e) => (
                  <tr key={e.forecastId}>
                    <td>
                      <b>
                        {pools.has(e.poolId)
                          ? `${pools.get(e.poolId)!.token0.symbol}/${pools.get(e.poolId)!.token1.symbol}`
                          : "Pool"}
                      </b>
                      <small>
                        <code title={e.poolId}>{short(e.poolId)}</code>
                      </small>
                      <small>{date(e.dueAt)}</small>
                    </td>
                    <td>
                      {money(e.projectedRevenue)} →{" "}
                      {money(e.observedRevenueProxy)}
                    </td>
                    <td>
                      {money(e.revenueError)}
                      <small>{pct(e.revenuePctError)}</small>
                    </td>
                    <td>
                      {number(e.projectedAllocation, true)} →{" "}
                      {number(e.observedAllocation, true)}
                    </td>
                    <td>
                      {number(e.allocationError, true)}
                      <small>{pct(e.allocationPctError)}</small>
                    </td>
                    <td>
                      {money(e.estimatedReturn)} →{" "}
                      {money(e.observedReturnProxy)}
                    </td>
                    <td>
                      {money(e.returnError)}
                      <small>{pct(e.returnPctError)}</small>
                    </td>
                    <td>
                      <Badge tone={e.status === "proxy" ? "good" : "warn"}>
                        {e.status === "proxy"
                          ? "Evaluated proxy"
                          : e.status === "pending"
                            ? "Awaiting 48h"
                            : "Incomplete data"}
                      </Badge>
                      <details className="evaluation-reason">
                        <summary>Why this status?</summary>
                        <p>{e.reason}</p>
                      </details>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{ledger.length} forecasts in this filter</span>
          <div>
            <button
              aria-label="Previous forecast page"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              ←
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button
              aria-label="Next forecast page"
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              →
            </button>
          </div>
        </div>
      </section>
      <div className="panel text-panel">
        <h3>What this evaluation can tell you</h3>
        <p>
          Revenue and allocation errors are reported separately. Percentage
          error is unavailable when the observed denominator is zero. Benchmark
          means use only cohorts where every strategy has a complete evaluation,
          and represent independent 48-hour holds rather than a compounded
          strategy.
        </p>
        <p>
          These overlapping forecast cohorts are correlated. The MVP does not
          claim statistical significance, calibrated accuracy or measured wallet
          returns. Stored fee-accumulator changes provide an additional
          per-power check when both token prices exist; exact counterfactual
          accounting needs event-level reconstruction.
        </p>
      </div>
    </>
  );
}
