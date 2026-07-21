import { kgToLb } from "@/lib/lifting/units";

/**
 * Lifting UI — display formatting. Weights are canonical kg in the data; Curtis logs and thinks in
 * whole POUNDS, so `lb` is the default and every weight renders as a whole number (via `kgToLb`).
 * A `kg` toggle exists but is secondary; kg shows at most one decimal. Nothing raw-float reaches the
 * screen. Dates use a timezone-safe string split (never `new Date(iso)`), matching the other modules.
 */

export type Unit = "lb" | "kg";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu · Jul 16, 2026" from an ISO instant, using only the date portion (safe for evening logs). */
export function dateLine(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[wd]} · ${MONTH[m - 1]} ${d}, ${y}`;
}

/** A canonical-kg weight for display: whole `lb` (default), or kg to at most 1 dp. Null → null. */
export function fmtWeight(kg: number | null | undefined, unit: Unit): string | null {
  if (kg == null) return null;
  if (unit === "lb") return String(kgToLb(kg));
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1);
}

/** Volume/tonnage (kg) with thousands separators, in the active unit (whole numbers). */
export function fmtVolume(kg: number, unit: Unit): string {
  const v = unit === "lb" ? kgToLb(kg)! : Math.round(kg);
  return v.toLocaleString("en-US");
}

/** Seconds → `m:ss` (or `h:mm:ss`) for timed/cardio sets. */
export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(h > 0 ? m : m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

/** The set of focus values in canonical order, for the journal filter chips. */
export const FOCUSES = ["push", "pull", "legs", "upper", "lower", "full", "accessory", "other"] as const;
