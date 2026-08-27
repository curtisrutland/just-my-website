/** Display helpers for the vitals module. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The one honest renderer for an absent measurement. Never "0", never blank. */
export const DASH = "—";

export const fmt0 = (n: number | null | undefined): string => (n == null ? DASH : Math.round(n).toString());
export const fmt1 = (n: number | null | undefined): string => (n == null ? DASH : n.toFixed(1));

/** Seconds → "6h 16m". Sleep is a duration, not a decimal. */
export function hm(seconds: number | null | undefined): string {
  if (seconds == null) return DASH;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** "2026-08-24" → "Aug 24" (timezone-safe — string parse, no Date). */
export function monthDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2026-08-24" → "Mon" (timezone-safe). */
export function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export type WindowKey = "14" | "30" | "90" | "all";
export const WINDOW_DAYS: Record<WindowKey, number> = { "14": 14, "30": 30, "90": 90, all: 365 };
export const WINDOW_LABEL: Record<WindowKey, string> = { "14": "14d", "30": "30d", "90": "90d", all: "all" };

/**
 * A week-over-week delta, rendered WITHOUT a verdict.
 *
 * This is the module's principle at its sharpest: resting HR down is not "good", HRV up is not
 * "recovered". We show the direction and the magnitude in the neutral text color and let the number
 * speak. No green, no red, no arrow that means anything but "which way".
 */
export function deltaText(delta: number | null, unit: string, digits = 0): string {
  if (delta == null) return DASH;
  if (Math.abs(delta) < (digits ? 0.05 : 0.5)) return `no change`;
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(delta).toFixed(digits)} ${unit}`;
}
