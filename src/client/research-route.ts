import type { Mode } from "../shared/types.js";
import type { ResearchPage } from "./Guide.js";

export type Page = ResearchPage | "guide";
import type { ScenarioBasis } from "../analysis/scenarios.js";
export type { ScenarioBasis } from "../analysis/scenarios.js";
export interface MarketFilters {
  search: string;
  chain: string;
  evidence: string;
  starred: boolean;
  page: number;
}
export const emptyFilters: MarketFilters = {
  search: "",
  chain: "all",
  evidence: "all",
  starred: false,
  page: 0,
};
export interface ResearchRoute {
  page: Page;
  mode: Mode;
  pool: string;
  market: MarketFilters;
  scenario: ScenarioBasis;
}
const pages: Page[] = [
  "markets",
  "opportunities",
  "analysis",
  "simulator",
  "performance",
  "guide",
];
export function readRoute(
  hash: string,
  fallbackMode: Mode = "live",
): ResearchRoute {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query);
  const pool = (params.get("pool") ?? "").toLowerCase();
  const pageNumber = Number(params.get("page") ?? 1);
  const evidence = params.get("evidence") ?? "all";
  const scenario = params.get("scenario");
  return {
    page: pages.includes(path as Page) ? (path as Page) : "markets",
    mode:
      (params.has("mode") ? params.get("mode") : fallbackMode) === "demo"
        ? "demo"
        : "live",
    pool: /^\d+:0x[\da-f]{40}$/.test(pool) ? pool : "",
    scenario:
      scenario === "stress" || scenario === "current" ? scenario : "forecast",
    market: {
      search: (params.get("q") ?? "").slice(0, 200),
      chain: (params.get("network") ?? "all").slice(0, 80),
      evidence: ["history", "baseline", "partial", "unavailable"].includes(
        evidence,
      )
        ? evidence
        : "all",
      starred: params.get("watch") === "1",
      page:
        Number.isSafeInteger(pageNumber) && pageNumber > 0
          ? Math.min(pageNumber - 1, 10000)
          : 0,
    },
  };
}
export function routeHash(route: ResearchRoute) {
  const params = new URLSearchParams({ mode: route.mode });
  if (route.pool && ["analysis", "simulator"].includes(route.page))
    params.set("pool", route.pool);
  if (route.page === "simulator" && route.scenario !== "forecast")
    params.set("scenario", route.scenario);
  if (route.page === "markets") {
    const f = route.market;
    if (f.search) params.set("q", f.search);
    if (f.chain !== "all") params.set("network", f.chain);
    if (f.evidence !== "all") params.set("evidence", f.evidence);
    if (f.starred) params.set("watch", "1");
    if (f.page) params.set("page", String(f.page + 1));
  }
  // Personal allocation, capital and timing inputs never go into a shared URL.
  return `#${route.page}?${params}`;
}
