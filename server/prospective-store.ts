import type { DatabaseSync } from "node:sqlite";
import {
  PROSPECTIVE_START,
  PROSPECTIVE_HOLD,
  PROSPECTIVE_GRACE,
  PROSPECTIVE_SLOTS,
  type ProspectiveChoices,
} from "../src/shared/prospective.js";
import type { Forecast } from "../src/shared/types.js";

export interface ProspectiveEntry {
  slot: number;
  at: number;
  startAt: number;
  dueAt: number;
  choices: ProspectiveChoices;
}

export function initializeProspective(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS prospective_slots_v1(
    slot INTEGER PRIMARY KEY, at INTEGER NOT NULL, start_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL, choices TEXT NOT NULL
  )`);
}

export function prospectiveEntries(db: DatabaseSync): ProspectiveEntry[] {
  // A read-only recovery copy can predate the trial.
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='prospective_slots_v1' AND type='table'",
      )
      .get()
  )
    return [];
  return db
    .prepare("SELECT * FROM prospective_slots_v1 ORDER BY slot")
    .all()
    .map((row) => ({
      slot: Number(row.slot),
      at: Number(row.at),
      startAt: Number(row.start_at),
      dueAt: Number(row.due_at),
      choices: JSON.parse(String(row.choices)),
    }));
}

// The caller holds the decisions write transaction through enrollment.
export function openProspectiveSlot(db: DatabaseSync, now: number) {
  const elapsed = now - PROSPECTIVE_START;
  const slot = Math.floor(elapsed / PROSPECTIVE_HOLD);
  if (
    slot < 0 ||
    slot >= PROSPECTIVE_SLOTS ||
    elapsed % PROSPECTIVE_HOLD >= PROSPECTIVE_GRACE
  )
    return null;
  const prior = db
    .prepare(
      "SELECT slot,due_at FROM prospective_slots_v1 ORDER BY slot DESC LIMIT 1",
    )
    .get();
  if (prior && Number(prior.slot) >= slot) return null;
  return { slot, previousEnd: prior ? Number(prior.due_at) : null };
}

export function freezeProspectiveSlot(
  db: DatabaseSync,
  candidate: { slot: number; previousEnd: number | null },
  at: number,
  choices: ProspectiveChoices,
  picks: Forecast[],
) {
  const startAt = picks.length ? Math.min(...picks.map((f) => f.madeAt)) : at;
  const dueAt = picks.length
    ? Math.max(...picks.map((f) => f.dueAt))
    : at + PROSPECTIVE_HOLD;
  if (candidate.previousEnd !== null && startAt < candidate.previousEnd) return;
  // Only an original decision with already available inputs can enroll.
  if (
    picks.some(
      (f) => Math.max(f.madeAt, f.input.observedAt, f.input.retrievedAt) > at,
    )
  )
    return;
  db.prepare(
    "INSERT INTO prospective_slots_v1(slot,at,start_at,due_at,choices) VALUES(?,?,?,?,?)",
  ).run(candidate.slot, at, startAt, dueAt, JSON.stringify(choices));
}
