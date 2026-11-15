import type { Maybe } from "../shared/types.js";

const currency = (digits: number, compact: boolean) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    notation: compact ? "compact" : "standard",
  });
const dollars = currency(0, false);
const cents = currency(2, false);
const compactDollars = currency(0, true);
const compactCents = currency(2, true);
const units = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactUnits = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

export function money(value: Maybe | undefined, compact = false) {
  if (value == null) return "—";
  const format = compact
    ? value < 10
      ? compactCents
      : compactDollars
    : value < 10
      ? cents
      : dollars;
  return format.format(value);
}
export const earningsMoney = (value: Maybe | undefined) =>
  value == null ? "—" : cents.format(value);
export const number = (value: Maybe | undefined, compact = false) =>
  value == null ? "—" : (compact ? compactUnits : units).format(value);
export const pct = (value: Maybe | undefined) =>
  value == null ? "—" : `${value.toFixed(2)}%`;
export const date = (time: number) =>
  new Date(time * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
