import type { RideView } from "@/lib/rides/types";

/**
 * Rides UI — display formatting. Storage is SI (m, s, m/s, W, bpm, kcal, °C); Curtis reads
 * IMPERIAL — miles at one decimal, whole feet, mph at one decimal, `h:mm:ss` (truncated).
 * Nothing raw-metric or unrounded reaches the screen (docs/rides-design-brief.md, STOP #2).
 * Dates use timezone-safe string splits on `localDate` — never `new Date(iso)` — matching the
 * other modules; the UTC date of `startedAt` is never shown (STOP #3).
 */

const MI = 1609.344;
const FT = 3.280839895;
const MPH = 2.2369363;

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Meters → "3.8" (miles, 1 dp). */
export const mi = (m: number): string => (m / MI).toFixed(1);
/** Meters → "289" / "2,661" (whole feet). */
export const ft = (m: number): string => Math.round(m * FT).toLocaleString("en-US");
/** m/s → "5.2" (mph, 1 dp). */
export const mph = (v: number): string => (v * MPH).toFixed(1);
/** Watts → whole (already whole in practice). */
export const watts = (v: number): string => String(Math.round(v));

/** Seconds → "43:41" / "2:56:01" (truncated — a ride of 43:41.5 reads 43:41). */
export function hms(sec: number): string {
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** 'YYYY-MM-DD' → "Jul 28". */
export function mdShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH[m - 1]} ${d}`;
}

/** 'YYYY-MM-DD' → "Tue Jul 28, 2026" (UTC weekday math on the calendar date — no TZ drift). */
export function mdLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[wd]} ${MONTH[m - 1]} ${d}, ${y}`;
}

/** Monday of the ISO week containing a 'YYYY-MM-DD' date, as 'YYYY-MM-DD'. */
export function weekStartOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

/** Display title: `name`, else "MTB — Jul 28" (sportProfileName + localDate; never a timestamp). */
export function rideTitle(r: Pick<RideView, "name" | "sport" | "sportProfileName" | "localDate">): string {
  return r.name ?? `${r.sportProfileName ?? r.sport} — ${mdShort(r.localDate)}`;
}

/** The card/detail tag: "MTB" / "INDOOR" / "ROAD" / the sport. */
export function rideTag(r: Pick<RideView, "sport" | "subSport">): string {
  if (r.subSport === "indoor_cycling") return "INDOOR";
  if (r.subSport === "mountain") return "MTB";
  if (r.subSport) return r.subSport.toUpperCase().replace(/_/g, " ");
  return r.sport.toUpperCase();
}

/** The card's mono stat line — absent sensors simply don't appear (STOP #1). */
export function rideStatLine(r: RideView): string {
  const parts: string[] = [];
  if (r.distanceMeters != null) parts.push(`${mi(r.distanceMeters)} mi`);
  parts.push(hms(r.movingSeconds));
  if (r.totalAscentMeters != null) parts.push(`${ft(r.totalAscentMeters)} ft`);
  if (r.avgPowerWatts != null) parts.push(`${watts(r.avgPowerWatts)} W`);
  if (r.avgHeartRate != null) parts.push(`${r.avgHeartRate} bpm`);
  return parts.join("  ·  ");
}

/** Weekly aggregate line: "3 rides · 24.1 mi · 1,102 ft · 4:02:11". */
export function weekLine(w: { rides: number; dist: number; asc: number; mov: number }): string {
  return [`${w.rides} ride${w.rides === 1 ? "" : "s"}`, `${mi(w.dist)} mi`, `${ft(w.asc)} ft`, hms(w.mov)].join(" · ");
}
