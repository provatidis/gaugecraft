import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Forecast, Mode, Run, Snapshot } from "../src/shared/types.js";
import { forecast } from "../src/analysis/forecast.js";
import { allocationEarnings } from "../src/analysis/earnings.js";
import { shortlist } from "../src/analysis/shortlist.js";
import { isFresh } from "../src/analysis/freshness.js";
import { initialize, STORAGE_VERSION, version } from "./storage-schema.js";
import { digest, RecordCodec } from "./storage-codec.js";
export const databasePath = () =>
  resolve(process.env.GAUGECRAFT_DB || "data/gaugecraft.sqlite");
export class Store {
  db: DatabaseSync;
  private leaseOwner = randomUUID();
  private codec: RecordCodec;
  constructor(path = databasePath(), { readOnly = false } = {}) {
    if (!readOnly && path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { readOnly });
    this.codec = new RecordCodec(this.db);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    try {
      if (readOnly) {
        if (![3, STORAGE_VERSION].includes(version(this.db)))
          throw new Error("Unsupported read-only storage version");
      } else {
        initialize(this.db);
        this.db.exec("PRAGMA journal_mode=WAL");
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private snapshot(row: Record<string, unknown>, includeRaw = true): Snapshot {
    const metrics = this.codec.decode<Omit<Snapshot, "raw">>(
      "snapshots",
      row.body,
    );
    const evidence = includeRaw
      ? this.db
          .prepare("SELECT body FROM raw_evidence WHERE hash=?")
          .get(String(row.raw_hash))
      : null;
    if (includeRaw && !evidence) throw new Error("Missing raw evidence");
    return {
      ...metrics,
      raw: evidence
        ? this.codec.decode<Record<string, unknown>>(
            "raw_evidence",
            evidence.body,
          )
        : {},
    };
  }
  private forecastWithInput(body: unknown, input: Snapshot): Forecast {
    return {
      ...this.codec.decode<Omit<Forecast, "input">>("forecasts", body),
      input,
    };
  }
  private prediction(
    row: Record<string, unknown>,
    includeRaw = true,
  ): Forecast {
    const input = this.db
      .prepare("SELECT body,raw_hash FROM snapshots WHERE input_hash=?")
      .get(String(row.input_hash));
    if (!input) throw new Error("Missing immutable forecast input");
    return this.forecastWithInput(row.body, this.snapshot(input, includeRaw));
  }

  close() {
    this.db.close();
  }
  acquire(now: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare("SELECT until,pid FROM leases WHERE name=?")
        .get("collector");
      let alive = false;
      if (prior?.pid) {
        try {
          process.kill(Number(prior.pid), 0);
          alive = true;
        } catch (e) {
          alive = (e as NodeJS.ErrnoException).code === "EPERM";
        }
      }
      if (prior && Number(prior.until) >= now && alive) {
        this.db.exec("COMMIT");
        return false;
      }
      this.db
        .prepare(
          "INSERT INTO leases(name,until,owner,pid) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET until=excluded.until,owner=excluded.owner,pid=excluded.pid",
        )
        .run("collector", now + 1200, this.leaseOwner, process.pid);
      this.db
        .prepare(
          "UPDATE runs SET status='error',finishedAt=?,error='Collector interrupted before completion; last successful observations preserved.' WHERE status='running'",
        )
        .run(now);
      this.db.exec("COMMIT");
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  renew(now: number) {
    this.db
      .prepare("UPDATE leases SET until=? WHERE name=? AND owner=?")
      .run(now + 1200, "collector", this.leaseOwner);
  }
  release() {
    this.db
      .prepare("DELETE FROM leases WHERE name=? AND owner=?")
      .run("collector", this.leaseOwner);
  }
  startRun(chainId: number, mode: Mode, now: number) {
    return Number(
      this.db
        .prepare(
          "INSERT INTO runs(startedAt,chainId,mode,status) VALUES(?,?,?,?)",
        )
        .run(now, chainId, mode, "running").lastInsertRowid,
    );
  }
  finishRun(
    id: number,
    status: Run["status"],
    count: number,
    error: string | null,
    now = Math.floor(Date.now() / 1000),
  ) {
    this.db
      .prepare(
        "UPDATE runs SET finishedAt=?,status=?,poolCount=?,error=? WHERE id=?",
      )
      .run(now, status, count, error, id);
  }
  runs(mode: Mode): Run[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE mode=? ORDER BY id DESC LIMIT 30")
      .all(mode) as unknown as Run[];
  }
  collectionDays(endExclusive: number) {
    const startInclusive = endExclusive - 21 * 86400;
    const networks = this.db
      .prepare(
        `
      WITH attempts AS (
        SELECT date(startedAt, 'unixepoch') AS day, chainId, status,
          startedAt / 1800 AS slot, poolCount,
          row_number() OVER (
            PARTITION BY startedAt / 86400, chainId
            ORDER BY (status = 'success') DESC, startedAt DESC, id DESC
          ) AS poolCountRank
        FROM runs
        WHERE mode = 'live' AND startedAt >= ? AND startedAt < ?
      )
      SELECT day, chainId, count(*) AS attempts,
        sum(status = 'success') AS successful, sum(status = 'partial') AS partial,
        sum(status = 'error') AS failed, sum(status = 'running') AS running,
        count(DISTINCT slot) AS attemptedHalfHours,
        max(CASE WHEN poolCountRank = 1 AND status = 'success' THEN poolCount END) AS lastSuccessfulPoolCount
      FROM attempts GROUP BY day, chainId ORDER BY day, chainId
    `,
      )
      .all(startInclusive, endExclusive);
    return { startInclusive, endExclusive, networks };
  }
  ingest(snapshots: Snapshot[], saveForecasts = true) {
    const insert = this.db.prepare(
      "INSERT INTO snapshots(mode,pool_id,bucket,at,chain_id,block,body,input_hash,raw_hash) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    const existing = this.db.prepare(
      "SELECT 1 FROM snapshots WHERE mode=? AND pool_id=? AND bucket=?",
    );
    const evidence = this.db.prepare("SELECT 1 FROM raw_evidence WHERE hash=?");
    const saveEvidence = this.db.prepare(
      "INSERT INTO raw_evidence VALUES(?,?)",
    );
    const saveForecast = this.db.prepare(
      "INSERT OR IGNORE INTO forecasts VALUES(?,?,?,?,?,?,?)",
    );
    let added = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const s of snapshots) {
        if (
          !Number.isFinite(s.observedAt) ||
          s.observedAt < 0 ||
          s.retrievedAt < s.observedAt - 60
        )
          throw new Error("Invalid UTC observation time");
        if (
          !/^\d+:0x[0-9a-f]{40}$/.test(s.id) ||
          s.id !== `${s.chainId}:${s.address.toLowerCase()}`
        )
          throw new Error("Pool identity mismatch");
        if (!["live", "demo"].includes(s.mode))
          throw new Error("Invalid source mode");
        const bucket = Math.floor(s.observedAt / 1800);
        if (existing.get(s.mode, s.id, bucket)) continue;
        const hash = digest(s);
        const { raw, ...metrics } = s;
        const rawHash = digest(raw);
        if (!evidence.get(rawHash))
          saveEvidence.run(rawHash, this.codec.encode("raw_evidence", raw));
        const changes = Number(
          insert.run(
            s.mode,
            s.id,
            bucket,
            s.observedAt,
            s.chainId,
            s.block,
            this.codec.encode("snapshots", metrics),
            hash,
            rawHash,
          ).changes,
        );
        added += changes;
        if (changes && saveForecasts) {
          const f = forecast(
            s,
            this.history(
              s.mode,
              s.id,
              s.observedAt - 48 * 3600,
              s.observedAt,
              false,
            ),
          );
          saveForecast.run(
            f.id,
            f.mode,
            f.poolId,
            f.madeAt,
            f.dueAt,
            this.codec.encode("forecasts", { ...f, input: undefined }),
            hash,
          );
        }
      }
      this.db.exec("COMMIT");
      return added;
    } catch (e) {
      this.codec.clear();
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  history(
    mode: Mode,
    id: string,
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
    includeRaw = true,
  ): Snapshot[] {
    return this.db
      .prepare(
        "SELECT body,raw_hash FROM snapshots WHERE mode=? AND pool_id=? AND at>=? AND at<=? ORDER BY at",
      )
      .all(mode, id, from, to)
      .map((r) => this.snapshot(r, includeRaw));
  }
  latestInWindow(
    mode: Mode,
    id: string,
    from: number,
    to: number,
    includeRaw = true,
  ): Snapshot | undefined {
    const row = this.db
      .prepare(
        "SELECT body,raw_hash FROM snapshots WHERE mode=? AND pool_id=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 1",
      )
      .get(mode, id, from, to);
    return row ? this.snapshot(row, includeRaw) : undefined;
  }
  private latestRows(table: "snapshots" | "forecasts", mode: Mode) {
    const time = table === "snapshots" ? "at" : "made_at";
    // The (mode, pool_id, time) indexes let SQLite jump from pool to pool.
    // A grouped MAX scans every historical index entry on each collection.
    return this.db
      .prepare(
        `WITH RECURSIVE pools(pool_id) AS (
           SELECT MIN(pool_id) FROM ${table} WHERE mode=$mode
           UNION ALL
           SELECT (SELECT MIN(next.pool_id) FROM ${table} next
                   WHERE next.mode=$mode AND next.pool_id>pools.pool_id)
           FROM pools WHERE pool_id IS NOT NULL
         )
         SELECT r.* FROM pools CROSS JOIN ${table} r ON r.rowid=(
           SELECT rowid FROM ${table} WHERE mode=$mode AND pool_id=pools.pool_id
           ORDER BY ${time} DESC, rowid DESC LIMIT 1
         ) WHERE pools.pool_id IS NOT NULL ORDER BY r.${time}, r.pool_id`,
      )
      .all({ mode });
  }
  latest(mode: Mode, includeRaw = true): Snapshot[] {
    return this.latestRows("snapshots", mode).map((r) =>
      this.snapshot(r, includeRaw),
    );
  }
  latestMarketInputs(mode: Mode) {
    const saved = new Map(
      this.latestRows("forecasts", mode).map((row) => [
        row.input_hash,
        row.body,
      ]),
    );
    return this.latestRows("snapshots", mode).map((row) => {
      const snapshot = this.snapshot(row, false);
      // Matching the immutable input hash reuses the exact observation already
      // decoded here, even when collecting without saving new forecasts.
      const body = saved.get(row.input_hash);
      return {
        snapshot,
        frozen: body ? this.forecastWithInput(body, snapshot) : null,
      };
    });
  }
  *observations(
    mode: Mode,
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
    includeRaw = true,
  ): Generator<Snapshot> {
    for (const row of this.db
      .prepare(
        "SELECT body,raw_hash FROM snapshots WHERE mode=? AND at>=? AND at<=? ORDER BY at,pool_id",
      )
      .iterate(mode, from, to))
      yield this.snapshot(row, includeRaw);
  }
  all(mode: Mode): Snapshot[] {
    return [...this.observations(mode)];
  }
  *fixtureExport(days: number): Generator<Snapshot> {
    // Each frozen fixture has its own endpoint. One read cursor retains
    // chronological CSV ordering and a consistent view across the fixture pools.
    const rows = this.db
      .prepare(
        `
      SELECT s.body,s.raw_hash FROM snapshots s
      WHERE s.mode='demo' AND s.at >= (
        SELECT MAX(p.at) FROM snapshots p WHERE p.mode=s.mode AND p.pool_id=s.pool_id
      ) - ?
      ORDER BY s.at,s.pool_id`,
      )
      .iterate(days * 86400);
    for (const row of rows) yield this.snapshot(row, false);
  }
  *frozenForecasts(mode: Mode): Generator<Forecast> {
    for (const row of this.db
      .prepare("SELECT body,input_hash FROM forecasts WHERE mode=? ORDER BY id")
      .iterate(mode))
      yield this.prediction(row);
  }
  forecasts(mode: Mode, limit = 3000): Forecast[] {
    return this.db
      .prepare(
        "SELECT body,input_hash FROM forecasts WHERE mode=? ORDER BY made_at DESC LIMIT ?",
      )
      .all(mode, limit)
      .map((r) => this.prediction(r));
  }
  evaluationForecasts(
    mode: Mode,
    now: number,
    ids: string[],
    includeRaw = true,
  ): Forecast[] {
    // Read newest first and stop once the sample is full. The due-date index
    // would sort all eligible forecast bodies before applying the limit.
    // Spell out its previous tie order for cohorts sharing a source timestamp.
    const recent = this.db
      .prepare(
        "SELECT body,input_hash FROM forecasts INDEXED BY forecast_dates WHERE mode=? AND due_at>? ORDER BY made_at DESC, due_at, rowid LIMIT 250",
      )
      .all(mode, now);
    const mature = this.db
      .prepare(
        "SELECT body,input_hash FROM forecasts INDEXED BY forecast_dates WHERE mode=? AND due_at<=? ORDER BY made_at DESC, due_at, rowid LIMIT 500",
      )
      .all(mode, now);
    const selected = ids.flatMap((id) => {
      const r = this.db
        .prepare("SELECT body,input_hash FROM forecasts WHERE mode=? AND id=?")
        .get(mode, id);
      return r ? [r] : [];
    });
    const parsed = [...recent, ...mature, ...selected].map((r) =>
      this.prediction(r, includeRaw),
    );
    return [...new Map(parsed.map((f) => [f.id, f])).values()];
  }
  saveDecision(mode: Mode, now: number) {
    const rows = this.latestMarketInputs(mode).flatMap(
      ({ snapshot, frozen }) =>
        frozen &&
        frozen.madeAt <= now &&
        snapshot.active &&
        isFresh(snapshot, now)
          ? [
              {
                snapshot,
                forecast: frozen,
                aprChange: null,
                allocationChange: null,
              },
            ]
          : [],
    );
    const estimates = new Map(
      rows.map((row) => [
        row.snapshot.id,
        allocationEarnings(row, 1000, 0, now),
      ]),
    );
    const screen = shortlist(rows, estimates, "all");
    // A baseline is useful in the UI but does not represent a history-qualified pick.
    const persistence = screen.qualified ? screen.visible[0].forecast.id : null;
    const choose = (metric: (s: Snapshot) => number | null) =>
      rows
        .flatMap((row) => {
          const score = metric(row.snapshot);
          return score !== null && Number.isFinite(score)
            ? [{ row, score }]
            : [];
        })
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.row.snapshot.id.localeCompare(b.row.snapshot.id),
        )[0]?.row.forecast.id ?? null;
    const choices = {
      persistence,
      highestApr: choose((s) => s.stakeApr),
      highestRewards: choose((s) => s.rewards48hUsd),
      highestFees: choose((s) => s.eligibleFees48hUsd),
    };
    this.db
      .prepare("INSERT OR IGNORE INTO decisions VALUES(?,?,?,?)")
      .run(mode, Math.floor(now / 1800), now, JSON.stringify(choices));
  }
  decisions(mode: Mode, now = Math.floor(Date.now() / 1000)) {
    return this.db
      .prepare(
        "SELECT at,body FROM decisions WHERE mode=? AND at<=? ORDER BY at DESC LIMIT 100",
      )
      .all(mode, now - 48 * 3600)
      .map((r) => ({
        at: Number(r.at),
        choices: JSON.parse(r.body as string) as Record<string, string | null>,
      }));
  }
}
