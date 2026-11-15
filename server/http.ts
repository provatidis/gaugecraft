import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { stat, statfs } from "node:fs/promises";
import { resolve, extname, sep, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Store } from "./store.js";
import { markets, overviewRows, poolCoverage } from "./markets.js";
import { performance } from "./performance.js";
import { csvLines } from "./csv.js";
import { configuredChains } from "./collector.js";
import { dataHealth } from "../src/analysis/freshness.js";
import { chartPoint } from "./pages-export.js";
import type { BackupStatus } from "./backup-scheduler.js";
import type { MarketRow, Mode } from "../src/shared/types.js";

const compress = promisify(gzip);
const poolId = /^\d+:0x[\da-f]{40}$/;
type StateBody = { json: string; etag: string; gzip?: Promise<Buffer> };
function acceptsGzip(header = "") {
  const encodings = header
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim().split(/\s*;\s*/));
  const match =
    encodings.find(([name]) => name === "gzip") ??
    encodings.find(([name]) => name === "*");
  return (
    !!match &&
    !match.slice(1).some((parameter) => /^q\s*=\s*0(?:\.0*)?$/.test(parameter))
  );
}

function representation(value: unknown): StateBody {
  return jsonRepresentation(JSON.stringify(value));
}

function jsonRepresentation(json: string): StateBody {
  return {
    json,
    etag: `W/"${createHash("sha256").update(json).digest("base64url")}"`,
  };
}

function readPerformance(database: string, mode: Mode, now: number) {
  return new Promise<StateBody>((resolve, reject) => {
    const worker = new Worker(
      new URL("./performance-worker.mjs", import.meta.url),
      {
        workerData: { database, mode, now },
        execArgv: [],
      },
    );
    worker.once("message", (json: string) => resolve(jsonRepresentation(json)));
    worker.once("error", reject);
    worker.once("exit", (code) =>
      reject(
        new Error(
          `Performance worker exited before returning a result (${code})`,
        ),
      ),
    );
  });
}

async function sendRepresentation(
  req: IncomingMessage,
  res: ServerResponse,
  body: StateBody,
) {
  res.appendHeader("Vary", "Accept-Encoding");
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("ETag", body.etag);
  res.setHeader("Access-Control-Expose-Headers", "ETag");
  if (
    req.headers["if-none-match"]
      ?.split(",")
      .some((tag) => [body.etag, body.etag.slice(2), "*"].includes(tag.trim()))
  ) {
    res.writeHead(304);
    res.end();
    return;
  }
  const compressed = acceptsGzip(req.headers["accept-encoding"]);
  if (compressed) res.setHeader("Content-Encoding", "gzip");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "HEAD") res.end();
  else if (compressed) {
    body.gzip ??= compress(body.json, { level: 4 });
    res.end(await body.gzip);
  } else res.end(body.json);
}

export function handler(
  store: Store,
  options: {
    hosts: string[];
    origins?: string[];
    collectorEnabled: boolean;
    database: string;
    backup?: BackupStatus;
    now?: () => number;
    development?: (req: IncomingMessage, res: ServerResponse) => void;
  },
) {
  const clock = options.now ?? (() => Math.floor(Date.now() / 1000));
  // Both ledgers are append-only. The rightmost rowid lookup is constant cost
  // and observes commits from both the in-process and external collectors.
  const revisionQuery = store.db.prepare(
    "SELECT (SELECT MAX(rowid) FROM snapshots) AS snapshot, (SELECT MAX(rowid) FROM forecasts) AS forecast",
  );
  const revision = () => {
    const row = revisionQuery.get()!;
    return `${row.snapshot}:${row.forecast}`;
  };
  const cache = new Map<
    string,
    { until: number; revision: string; value: any }
  >();
  const cached = <T>(key: string, seconds: number, build: () => T): T => {
    const old = cache.get(key);
    const rev = revision();
    if (old && old.until > clock() && old.revision === rev) return old.value;
    const value = build();
    if (!old && cache.size >= 24) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: clock() + seconds, revision: rev, value });
    return value;
  };
  // With fixed inputs, evaluation results can next change at a forecast's
  // maturity, a saved decision's maturity, or a stored future observation.
  const nextEvaluation = store.db.prepare(`
    SELECT MIN(at) AS at FROM (
      SELECT MIN(due_at) AS at FROM forecasts WHERE mode=$mode AND due_at>$now
      UNION ALL SELECT MIN(at)+172800 FROM decisions WHERE mode=$mode AND at>$now-172800
      UNION ALL SELECT MIN(at) FROM snapshots WHERE mode=$mode AND at>$now
    )`);
  const decisionRevision = store.db.prepare(
    "SELECT MAX(rowid) AS id FROM decisions",
  );
  const evaluations = new Map<
    Mode,
    { revision: string; from: number; until: number; body: Promise<StateBody> }
  >();
  const inFlight = new Map<Mode, Promise<StateBody>>();
  async function performanceBody(mode: Mode): Promise<StateBody> {
    const rev = `${revision()}:${decisionRevision.get()!.id}`;
    const now = clock();
    const old = evaluations.get(mode);
    if (old && old.revision === rev && now >= old.from && now < old.until)
      return old.body;
    // If a collection or maturity happened during an older read, finish it
    // before opening another SQLite reader for this mode.
    const previous = inFlight.get(mode);
    if (previous) {
      await previous.catch(() => {});
      return performanceBody(mode);
    }
    const until = Number(nextEvaluation.get({ mode, now })!.at ?? Infinity);
    const body =
      options.database === ":memory:"
        ? Promise.resolve(representation(performance(store, mode, now)))
        : readPerformance(options.database, mode, now);
    evaluations.set(mode, { revision: rev, from: now, until, body });
    inFlight.set(mode, body);
    try {
      return await body;
    } catch (error) {
      evaluations.delete(mode);
      throw error;
    } finally {
      inFlight.delete(mode);
    }
  }
  const views = new Map<
    string,
    { revision: string; rows: MarketRow[]; runKey?: string; body?: StateBody }
  >();
  function stateBody(mode: Mode, overview: boolean) {
    const key = `${mode}:${overview}`;
    const rev = revision();
    let view = views.get(key);
    if (!view || view.revision !== rev) {
      view = { revision: rev, rows: markets(store, mode, !overview) };
      views.set(key, view);
    }
    const runs = store.runs(mode);
    const now = clock();
    // Legacy clients use now as the request time. Overview clients use the
    // view generation time and advance observation age on their own clock.
    const runKey = JSON.stringify([overview ? null : now, runs]);
    if (!view.body || view.runKey !== runKey) {
      view.body = representation({
        mode,
        now,
        markets: overview ? overviewRows(view.rows) : view.rows,
        runs,
        collectorEnabled: options.collectorEnabled,
        collectionKind: "persistent-service",
        configuredChains: configuredChains(),
      });
      view.runKey = runKey;
    }
    return view.body;
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    const send = (code: number, value: unknown) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const host = new URL(`http://${req.headers.host ?? "invalid"}`).hostname;
      if (!options.hosts.includes(host)) {
        send(403, { error: "Host not allowed" });
        return;
      }
      const origin = req.headers.origin;
      if (options.origins?.length) res.setHeader("Vary", "Origin");
      if (origin && options.origins?.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(405, { error: "Read-only service" });
        return;
      }
      const url = new URL(req.url || "/", "http://localhost");
      const mode: Mode =
        url.searchParams.get("mode") === "demo" ? "demo" : "live";
      if (url.pathname === "/health/live") {
        send(200, { status: "up" });
        return;
      }
      if (url.pathname === "/health/data") {
        const health = dataHealth(
          cached("health:live", Infinity, () =>
            store.latest("live", false).map((snapshot) => ({ snapshot })),
          ),
          configuredChains(),
          store.runs("live"),
          "live",
          clock(),
        );
        const ok =
          health.currentNetworks === health.networks.length &&
          health.issues === 0;
        send(ok ? 200 : 503, {
          status: ok ? "current" : "attention",
          newest: health.newest,
          oldest: health.oldest,
          stalePools: health.stalePools,
          currentNetworks: health.currentNetworks,
          expectedNetworks: health.networks.length,
          collectionIssues: health.issues,
        });
        return;
      }
      if (url.pathname === "/health/collection-days") {
        const end = Math.floor(clock() / 86400) * 86400;
        send(
          200,
          cached(`collection-days:${end}`, 300, () =>
            store.collectionDays(end),
          ),
        );
        return;
      }
      if (url.pathname === "/health/storage") {
        const disk = await statfs(dirname(options.database));
        const free = disk.bavail * disk.bsize,
          total = disk.blocks * disk.bsize;
        const size = (await stat(options.database)).size;
        const backup = options.backup;
        const currentBackup =
          !!backup?.lastSuccess &&
          clock() - Date.parse(backup.lastSuccess) / 1000 < 36 * 3600;
        const ok =
          free > Math.max(1024 ** 3, total * 0.15) &&
          (!backup?.enabled || (currentBackup && !backup.error));
        send(ok ? 200 : 503, {
          status: ok ? "healthy" : "attention",
          databaseBytes: size,
          reusablePageBytes:
            Number(
              store.db.prepare("PRAGMA freelist_count").get()!.freelist_count,
            ) * Number(store.db.prepare("PRAGMA page_size").get()!.page_size),
          freeBytes: free,
          backup: {
            enabled: backup?.enabled ?? false,
            lastSuccess: backup?.lastSuccess ?? null,
            current: currentBackup,
            running: backup?.running ?? false,
            error: backup?.error ?? null,
          },
        });
        return;
      }
      if (url.pathname === "/api/state") {
        const body = stateBody(
          mode,
          url.searchParams.get("view") === "overview",
        );
        await sendRepresentation(req, res, body);
        return;
      }
      if (url.pathname === "/api/coverage") {
        const id = url.searchParams.get("pool") ?? "";
        const at = Number(url.searchParams.get("at"));
        if (
          !poolId.test(id) ||
          !url.searchParams.has("at") ||
          !Number.isSafeInteger(at) ||
          at < 0
        ) {
          send(400, { error: "Invalid coverage observation" });
          return;
        }
        const coverage = cached(`coverage:${mode}:${id}:${at}`, 1800, () =>
          poolCoverage(store, mode, id, at),
        );
        if (coverage) send(200, coverage);
        else send(404, { error: "Observation not found" });
        return;
      }
      if (url.pathname === "/api/history") {
        const id = url.searchParams.get("pool") ?? "",
          days = Math.min(
            30,
            Math.max(1, Number(url.searchParams.get("days")) || 2),
          );
        if (!poolId.test(id)) {
          send(400, { error: "Invalid pool ID" });
          return;
        }
        send(
          200,
          cached(`history:${mode}:${id}:${days}`, 30, () => {
            const end =
              mode === "demo"
                ? Number(
                    store.db
                      .prepare(
                        "SELECT MAX(at) AS at FROM snapshots WHERE mode=? AND pool_id=?",
                      )
                      .get(mode, id)!.at ?? 0,
                  )
                : clock();
            return store
              .history(mode, id, end - days * 86400, end, false)
              .map(chartPoint);
          }),
        );
        return;
      }
      if (url.pathname === "/api/performance") {
        await sendRepresentation(req, res, await performanceBody(mode));
        return;
      }
      if (url.pathname === "/api/export.csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="gaugecraft-${mode}-30d.csv"`,
        );
        res.setHeader("Cache-Control", "no-store");
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        // A separate read connection gives the streamed export a consistent SQLite view.
        const reader = new Store(options.database, { readOnly: true });
        try {
          const end = clock();
          const observations =
            mode === "demo"
              ? reader.fixtureExport(30)
              : reader.observations(mode, end - 30 * 86400, end, false);
          await pipeline(Readable.from(csvLines(observations)), res);
        } finally {
          reader.close();
        }
        return;
      }
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/health/")
      ) {
        send(404, { error: "Unknown endpoint" });
        return;
      }
      if (options.development) {
        options.development(req, res);
        return;
      }
      const base = resolve("dist");
      let file = resolve(base, "." + decodeURIComponent(url.pathname));
      if (file !== base && !file.startsWith(base + sep)) {
        send(404, { error: "Not found" });
        return;
      }
      if (file === base || !extname(file)) file = resolve(base, "index.html");
      if (url.pathname === "/SOURCES.md" || url.pathname === "/PLAN.md")
        file = resolve(url.pathname.slice(1));
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error("Not a file");
        res.writeHead(200, {
          "Content-Type":
            (
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".webmanifest": "application/manifest+json",
                ".md": "text/plain; charset=utf-8",
              } as Record<string, string>
            )[extname(file)] ?? "application/octet-stream",
          "Content-Length": info.size,
          "Cache-Control": file.includes(`${sep}assets${sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        });
        if (req.method === "HEAD") res.end();
        else await pipeline(createReadStream(file), res);
      } catch {
        if (!res.headersSent) send(404, { error: "File not found" });
      }
    } catch {
      console.error("Read-only request failed");
      if (!res.headersSent) send(500, { error: "Data request failed" });
      else res.destroy();
    }
  };
}
