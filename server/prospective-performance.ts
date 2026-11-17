import { evaluateForecast } from "../src/analysis/forecast.js";
import { median } from "../src/analysis/math.js";
import {
  PROSPECTIVE_CLOSE,
  PROSPECTIVE_GRACE,
  PROSPECTIVE_HOLD,
  PROSPECTIVE_SLOTS,
  PROSPECTIVE_START,
  prospectiveRules,
  type ProspectiveComparison,
  type ProspectivePick,
  type ProspectiveRule,
  type ProspectiveSlot,
  type ProspectiveView,
} from "../src/shared/prospective.js";
import type { Evaluation } from "../src/shared/types.js";
import { feeTapeReader } from "./fee-tape-evidence.js";
import {
  prospectiveEntries,
  type ProspectiveEntry,
} from "./prospective-store.js";
import type { Store } from "./store.js";

const schedule = Array.from(
  { length: PROSPECTIVE_SLOTS },
  (_, slot) => PROSPECTIVE_START + slot * PROSPECTIVE_HOLD,
);

export function nextProspectiveChange(
  entries: ProspectiveEntry[],
  now: number,
) {
  let next = Infinity;
  const consider = (t: number) => {
    if (t > now) next = Math.min(next, t);
  };
  for (const [slot, start] of schedule.entries()) {
    consider(start);
    const entry = entries.find((e) => e.slot === slot);
    if (entry) {
      consider(entry.at);
      consider(entry.dueAt);
      consider(entry.dueAt + PROSPECTIVE_CLOSE);
    } else {
      consider(start + PROSPECTIVE_GRACE);
    }
  }
  return next;
}

function compare(
  slots: ProspectiveSlot[],
  left: ProspectiveRule,
  right: ProspectiveRule,
): ProspectiveComparison {
  let matched = 0,
    samePool = 0,
    missing = 0,
    wins = 0,
    losses = 0,
    ties = 0;
  const differences: number[] = [];
  for (const slot of slots) {
    if (slot.status === "missed") {
      missing++;
      continue;
    }
    if (slot.status !== "mature") continue;
    const a = slot.picks![left],
      b = slot.picks![right];
    if (a.observedReturnProxy === null || b.observedReturnProxy === null) {
      missing++;
      continue;
    }
    matched++;
    if (a.poolId === b.poolId) {
      samePool++;
      continue;
    }
    const delta = a.observedReturnProxy - b.observedReturnProxy;
    const epsilon =
      1e-12 *
      Math.max(
        1,
        Math.abs(a.observedReturnProxy),
        Math.abs(b.observedReturnProxy),
      );
    if (Math.abs(delta) <= epsilon) ties++;
    else if (delta > 0) wins++;
    else losses++;
    differences.push(delta);
  }
  return {
    left,
    right,
    matched,
    samePool,
    wins,
    ties,
    losses,
    missing,
    medianDifference: median(differences),
    worstDifference: differences.length ? Math.min(...differences) : null,
  };
}

export function prospectivePerformance(
  store: Store,
  now: number,
  known: ReadonlyMap<string, Evaluation> = new Map(),
): ProspectiveView {
  const entries = new Map(prospectiveEntries(store.db).map((e) => [e.slot, e]));
  const tape = feeTapeReader(store.db);
  // One forecast can win several rules in a slot. Decode it and its evidence once.
  const pickCache = new Map<string, ProspectivePick>();
  function pick(id: string | null, released: boolean): ProspectivePick {
    if (!id)
      return {
        forecastId: null,
        poolId: null,
        label: null,
        observedReturnProxy: null,
        reason: "No eligible pool was selected.",
      };
    const cached = pickCache.get(id);
    if (cached) return cached;
    const f = store.forecastById("live", id, false);
    if (!f)
      return {
        forecastId: id,
        poolId: null,
        label: null,
        observedReturnProxy: null,
        reason: "The saved forecast is unavailable.",
      };
    const s = f.input;
    const poolType = s.poolType > 0 ? `CL${s.poolType}` : "Basic";
    const value: ProspectivePick = {
      forecastId: id,
      poolId: f.poolId,
      label: `${s.token0.symbol}/${s.token1.symbol} · ${s.chain} · ${poolType}`,
      observedReturnProxy: null,
      reason: null,
    };
    if (released) {
      // Limiting each read to its actual hold avoids decoding the intervening weeks.
      const e =
        known.get(id) ??
        evaluateForecast(
          f,
          store.history(
            "live",
            f.poolId,
            f.madeAt - PROSPECTIVE_CLOSE,
            f.dueAt + PROSPECTIVE_CLOSE,
            false,
          ),
          now,
          tape,
        );
      if (
        e.status === "proxy" &&
        e.observedReturnProxy !== null &&
        Number.isFinite(e.observedReturnProxy)
      ) {
        value.observedReturnProxy = e.observedReturnProxy;
      } else {
        value.reason = e.reason;
      }
    }
    pickCache.set(id, value);
    return value;
  }
  const slots: ProspectiveSlot[] = [];
  for (const [slot, scheduledAt] of schedule.entries()) {
    if (scheduledAt > now) break;
    const e = entries.get(slot);
    if (!e || e.at > now) {
      slots.push({
        slot,
        scheduledAt,
        at: null,
        dueAt: null,
        status: now < scheduledAt + PROSPECTIVE_GRACE ? "open" : "missed",
        picks: null,
      });
      continue;
    }
    const status =
      now < e.dueAt
        ? "holding"
        : now < e.dueAt + PROSPECTIVE_CLOSE
          ? "settling"
          : "mature";
    const picks = Object.fromEntries(
      prospectiveRules.map((rule) => [
        rule,
        pick(e.choices[rule], status === "mature"),
      ]),
    ) as Record<ProspectiveRule, ProspectivePick>;
    slots.push({ slot, scheduledAt, at: e.at, dueAt: e.dueAt, status, picks });
  }
  const headToHead = compare(slots, "returning", "persistence");
  const comparisons = [headToHead];
  for (const rival of [
    "highestFees",
    "highestRewards",
    "highestApr",
  ] as const) {
    comparisons.push(
      compare(slots, "persistence", rival),
      compare(slots, "returning", rival),
    );
  }
  return {
    startsAt: PROSPECTIVE_START,
    intervalSeconds: PROSPECTIVE_HOLD,
    graceSeconds: PROSPECTIVE_GRACE,
    totalSlots: PROSPECTIVE_SLOTS,
    nextAt: schedule[slots.length] ?? null,
    recorded: slots.filter((s) => s.at !== null).length,
    mature: slots.filter((s) => s.status === "mature").length,
    missed: slots.filter((s) => s.status === "missed").length,
    comparable: headToHead.matched,
    slots,
    comparisons,
  };
}
