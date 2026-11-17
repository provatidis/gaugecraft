import { HORIZON } from "../analysis/math.js";

export const PROSPECTIVE_START = Date.UTC(2026, 10, 17, 22) / 1000;
export const PROSPECTIVE_HOLD = HORIZON;
export const PROSPECTIVE_GRACE = 2 * 3600;
export const PROSPECTIVE_SLOTS = 30;
export const PROSPECTIVE_CLOSE = 45 * 60;
export const prospectiveRules = [
  "persistence",
  "returning",
  "highestFees",
  "highestRewards",
  "highestApr",
] as const;

export type ProspectiveRule = (typeof prospectiveRules)[number];
export type ProspectiveChoices = Record<ProspectiveRule, string | null>;

export interface ProspectivePick {
  forecastId: string | null;
  poolId: string | null;
  label: string | null;
  observedReturnProxy: number | null;
  reason: string | null;
}

export interface ProspectiveSlot {
  slot: number;
  scheduledAt: number;
  at: number | null;
  dueAt: number | null;
  status: "open" | "missed" | "holding" | "settling" | "mature";
  picks: Record<ProspectiveRule, ProspectivePick> | null;
}

export interface ProspectiveComparison {
  left: ProspectiveRule;
  right: ProspectiveRule;
  matched: number;
  samePool: number;
  // All five difference statistics use matched slots with different pools only.
  wins: number;
  ties: number;
  losses: number;
  medianDifference: number | null;
  worstDifference: number | null;
  // Includes missed enrollment slots and released slots with no complete pair.
  missing: number;
}

export interface ProspectiveView {
  startsAt: number;
  intervalSeconds: number;
  graceSeconds: number;
  totalSlots: number;
  nextAt: number | null;
  recorded: number;
  mature: number;
  missed: number;
  comparable: number;
  slots: ProspectiveSlot[];
  comparisons: ProspectiveComparison[];
}
