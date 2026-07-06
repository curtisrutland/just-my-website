/** Calendar-date formatting from 'YYYY-MM-DD' strings — timezone-safe (never routes through a
 *  local Date parse, which would drift the weekday across timezones). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const WEEKDAYS_2 = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function weekdayIndex(iso: string): number {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Jul 5" */
export function monthDay(iso: string): string {
  const { m, d } = parts(iso);
  return `${MONTHS[m - 1]} ${d}`;
}

export function year(iso: string): string {
  return String(parts(iso).y);
}

export function dayOfMonth(iso: string): number {
  return parts(iso).d;
}

/** "SUNDAY" */
export function weekdayFull(iso: string): string {
  return WEEKDAYS[weekdayIndex(iso)];
}

/** "SU" */
export function weekday2(iso: string): string {
  return WEEKDAYS_2[weekdayIndex(iso)];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Shift a calendar date by n days (UTC math, so no DST/timezone drift). */
export function addDays(iso: string, n: number): string {
  const { y, m, d } = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Today's calendar date in the server's LOCAL timezone. In production set the `TZ` env var to
 *  Curtis's timezone so "today" matches his day (Vercel runs UTC by default) — see backlog. */
export function todayISO(): string {
  const dt = new Date();
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Inclusive [from, to] list of calendar dates. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
