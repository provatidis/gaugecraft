import type { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldToServer } from "node:timers/promises";
import type { FeeTapePoint, Snapshot } from "../src/shared/types.js";
import {
  alignedFeeWindow,
  FEE_TAPE_BOUNDARY_SECONDS,
  feeTapeBounds,
} from "../src/analysis/fee-window.js";
import type { Store } from "./store.js";
import { prospectiveEntries } from "./prospective-store.js";

function hasFeeTape(db: DatabaseSync) {
  return !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fee_tape_points'",
    )
    .get();
}
export function feeTapeReader(db: DatabaseSync) {
  const select = hasFeeTape(db)
    ? db.prepare(
        "SELECT tape,block_hash AS blockHash,fee0,fee1,last_swap_at AS lastSwapAt FROM fee_tape_points WHERE pool_id=? AND block_hash=?",
      )
    : null;
  return (s: Snapshot): FeeTapePoint | null => {
    if (s.mode !== "live" || !select) return null;
    const row = select.get(s.id, s.blockHash);
    return row
      ? {
          tape: String(row.tape),
          blockHash: String(row.blockHash),
          fee0: String(row.fee0),
          fee1: String(row.fee1),
          lastSwapAt: Number(row.lastSwapAt),
        }
      : null;
  };
}
export function feeTapeRevision(db: DatabaseSync) {
  return hasFeeTape(db)
    ? Number(
        db
          .prepare("SELECT coalesce(max(rowid),0) AS rev FROM fee_tape_points")
          .get()!.rev,
      )
    : 0;
}

export interface FeeTapeSource {
  supports(s: Snapshot): boolean;
  read(s: Snapshot, signal: AbortSignal): Promise<FeeTapePoint | null>;
}

export function feeTapeWorker(store: Store, source: FeeTapeSource) {
  // Additive evidence only. The native SQLite backup includes this table;
  // older read-only archives simply have no independent fee-window evidence.
  store.db.exec(`CREATE TABLE IF NOT EXISTS fee_tape_points (
    pool_id TEXT NOT NULL, block_hash TEXT NOT NULL, tape TEXT NOT NULL,
    fee0 TEXT NOT NULL, fee1 TEXT NOT NULL, last_swap_at INTEGER NOT NULL,
    PRIMARY KEY(pool_id,block_hash))`);
  const lookup = feeTapeReader(store.db);
  const save = store.db
    .prepare(`INSERT INTO fee_tape_points(pool_id,block_hash,tape,fee0,fee1,last_swap_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(pool_id,block_hash) DO NOTHING`);
  // Keep frozen trial picks eligible even after the rolling Performance sample advances.
  const after = new Map<string, number>();
  const chainRetry = new Map<number, { at: number; failures: number }>();

  return async function run(
    now: number,
    signal: AbortSignal,
    paused: () => boolean = () => false,
  ) {
    const maturedTrial = prospectiveEntries(store.db).filter(
      (entry) => entry.dueAt <= now,
    );
    const selected = new Set(
      [...store.decisions("live", now), ...maturedTrial]
        .flatMap((d) => Object.values(d.choices))
        .filter((id): id is string => !!id),
    );
    for (const id of after.keys()) if (!selected.has(id)) after.delete(id);
    let examined = 0,
      reads = 0,
      added = 0;
    for (const id of selected) {
      if ((after.get(id) ?? 0) > now) continue;
      if (signal.aborted || paused() || examined >= 16 || reads >= 10) break;
      examined++;
      const f = store.forecastById("live", id);
      if (!f || !source.supports(f.input)) {
        after.set(id, Infinity);
        continue;
      }
      // A failed provider must not monopolize the budget or starve other networks.
      const retry = chainRetry.get(f.input.chainId);
      if (retry && retry.at > now) {
        after.set(id, retry.at);
        continue;
      }
      const endpoint = store.history(
        "live",
        f.poolId,
        f.dueAt,
        Math.min(now, f.dueAt + 2700),
        false,
      )[0];
      if (!endpoint) {
        after.set(id, now <= f.dueAt + 2700 ? now + 60 : Infinity);
        continue;
      }
      if (
        (alignedFeeWindow(endpoint, f.madeAt, f.dueAt) &&
          endpoint.eligibleFees48hUsd !== null) ||
        endpoint.programs === null ||
        endpoint.allocation === null ||
        endpoint.stakedFraction === null
      ) {
        after.set(id, Infinity);
        continue;
      }
      const closing = store.latestInWindow(
        "live",
        f.poolId,
        f.dueAt - FEE_TAPE_BOUNDARY_SECONDS,
        f.dueAt,
        false,
      );
      const bounds = closing && feeTapeBounds(f, [closing]);
      if (!bounds) {
        after.set(id, Infinity);
        continue;
      }
      let nextAttempt = Infinity;
      for (const s of [bounds.start, bounds.end]) {
        if (lookup(s)) continue;
        if (signal.aborted || paused() || reads >= 10) {
          nextAttempt = 0;
          break;
        }
        reads++;
        let point: FeeTapePoint | null;
        try {
          point = await source.read(s, signal);
        } catch {
          if (signal.aborted) {
            nextAttempt = 0;
            break;
          }
          // A single unavailable block need not delay other blocks. Repeated
          // errors across requests back off the provider as well.
          const failures = Math.min(
            6,
            (chainRetry.get(s.chainId)?.failures ?? 0) + 1,
          );
          const delay =
            failures === 1 ? 0 : Math.min(300, 15 * 2 ** (failures - 2));
          chainRetry.set(s.chainId, { at: now + delay, failures });
          nextAttempt = now + 300 * failures;
          break;
        }
        if (signal.aborted) {
          nextAttempt = 0;
          break;
        }
        if (!point || point.blockHash !== s.blockHash) {
          // Unsupported historical pool configuration or unavailable archive evidence.
          nextAttempt = now + 21600;
          break;
        }
        added += Number(
          save.run(
            s.id,
            s.blockHash,
            point.tape,
            point.fee0,
            point.fee1,
            point.lastSwapAt,
          ).changes,
        );
        chainRetry.delete(s.chainId);
      }
      after.set(id, nextAttempt);
      await yieldToServer();
    }
    const pending = [...selected].some((id) => (after.get(id) ?? 0) <= now);
    return { examined, reads, added, pending };
  };
}

export function scheduleFeeTape(
  store: Store,
  source: FeeTapeSource,
  backupRunning: () => boolean,
) {
  const run = feeTapeWorker(store, source);
  const abort = new AbortController();
  const collectorLease = store.db.prepare(
    "SELECT 1 FROM leases WHERE name='collector' AND until>=?",
  );
  const now = () => Math.floor(Date.now() / 1000);
  const paused = () => backupRunning() || !!collectorLease.get(now());
  let active: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout>;
  function later(ms: number) {
    if (abort.signal.aborted) return;
    timer = setTimeout(() => {
      active = tick();
    }, ms);
    timer.unref();
  }
  async function tick() {
    try {
      if (paused()) {
        later(15000);
        return;
      }
      const result = await run(now(), abort.signal, paused);
      if (result.added)
        console.log(
          `Historical trading fees: verified ${result.added} pool blocks.`,
        );
      later(result.pending ? 5000 : 60000);
    } catch {
      // Historical RPC and optional evidence must not interrupt the live collector.
      console.error(
        "Historical trading fees deferred; saved observations retained.",
      );
      later(60000);
    }
  }
  later(1000);
  return async () => {
    abort.abort();
    clearTimeout(timer);
    await active;
  };
}
