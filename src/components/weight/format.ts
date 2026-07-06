/** Display helpers for the weight module. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmt1 = (n: number | null): string => (n == null ? "—" : n.toFixed(1));

/** "2026-07-05" → "Jul 5" (timezone-safe — string parse). */
export function monthDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Trend rate → arrow + signed text + color (down is calmly good; up is over). */
export function trendDisplay(perWeek: number | null): { text: string; arrow: string; color: string } {
  if (perWeek == null) return { text: "—", arrow: "→", color: "var(--color-text-muted)" };
  const flat = Math.abs(perWeek) < 0.05;
  const sign = perWeek < 0 ? "−" : perWeek > 0 ? "+" : "";
  return {
    text: `${sign}${Math.abs(perWeek).toFixed(1)} lb/wk`,
    arrow: flat ? "→" : perWeek < 0 ? "↓" : "↑",
    color: flat ? "var(--color-text-muted)" : perWeek < 0 ? "var(--color-success)" : "var(--color-over)",
  };
}

export type WindowKey = "30" | "90" | "365" | "all";
export const WINDOW_DAYS: Record<WindowKey, number> = { "30": 30, "90": 90, "365": 365, all: 3650 };
export const WINDOW_LABEL: Record<WindowKey, string> = { "30": "30d", "90": "90d", "365": "1y", all: "all" };
export const WINDOW_SUB: Record<WindowKey, string> = {
  "30": "past 30 days",
  "90": "past 90 days",
  "365": "past year",
  all: "all time",
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function utcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** "today" / "yest" / weekday, for a date relative to `today`. */
export function relLabel(iso: string, today: string): string {
  const daysAgo = Math.round((utcMs(today) - utcMs(iso)) / 86_400_000);
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yest";
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "Jul 05" (padded day, for column alignment). */
export function monthDayPad(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(d).padStart(2, "0")}`;
}

export const WEIGHT_GRID = "130px 96px 64px 1fr 64px";
