import type { HistoryPoint, MarketRow, Mode } from "../shared/types.js";

const apiOrigin = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");
export const hosted = !apiOrigin && import.meta.env.VITE_DATA_MODE === "static";
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;
export const exportUrl = (mode: Mode) =>
  hosted
    ? assetUrl(`data/${mode}/observations.csv`)
    : `${apiOrigin}/api/export.csv?mode=${mode}`;

// Revalidate with the server on each request. When the browser reuses an
// identical response, retain the already-parsed view and React row identities.
const parsed = new Map<string, { url: string; etag: string; value: unknown }>();

export async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const route = new URL(url, window.location.origin);
  const mode = route.searchParams.get("mode") === "demo" ? "demo" : "live";
  const state = route.pathname === "/api/state";
  if (state) route.searchParams.set("view", "overview");
  let target = `${apiOrigin}${route.pathname}${route.search}`;
  if (hosted) {
    const resource = route.pathname.split("/").at(-1);
    if (resource === "history") {
      const id = route.searchParams.get("pool") ?? "";
      if (!/^\d+:0x[\da-f]{40}$/.test(id)) throw new Error("Invalid pool ID");
      target = assetUrl(`data/${mode}/history/${id.replace(":", "-")}.json`);
    } else if (resource === "state" || resource === "performance") {
      target = assetUrl(`data/${mode}/${state ? "overview" : resource}.json`);
    } else throw new Error("Unknown published data resource");
  }
  const options = { signal, cache: "no-cache" as const };
  let response = await fetch(target, options);
  if (hosted && state && response.status === 404)
    response = await fetch(assetUrl(`data/${mode}/state.json`), options);
  if (!response.ok)
    throw new Error(
      "Observation data is currently unavailable. Please refresh shortly.",
    );
  const view =
    state || route.pathname === "/api/performance" ? route.pathname : null;
  const etag = view && response.headers.get("etag");
  const prior = view && parsed.get(view);
  if (prior && etag && prior.etag === etag && prior.url === response.url) {
    await response.body?.cancel();
    return prior.value as T;
  }
  const result = await response.json();
  if (state) {
    for (const row of result.markets as MarketRow[])
      row.forecast.input ??= row.snapshot;
  }
  if (view && etag)
    parsed.set(view, { url: response.url, etag, value: result });
  if (hosted && route.pathname === "/api/history") {
    const days = Math.min(
      30,
      Math.max(1, Number(route.searchParams.get("days")) || 2),
    );
    // Published files are chronological. A fixture's recorded window stays
    // explorable as the calendar advances.
    const end =
      mode === "demo"
        ? (result.at(-1)?.observedAt ?? 0)
        : Math.floor(Date.now() / 1000);
    return result.filter(
      (point: HistoryPoint) =>
        point.observedAt >= end - days * 86400 && point.observedAt <= end,
    ) as T;
  }
  return result as T;
}
