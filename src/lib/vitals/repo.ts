import { and, asc, count, desc, eq, gte, isNull, lte, max, min } from "drizzle-orm";
import { addDays, dateRange } from "@/lib/date";
import { db } from "@/lib/db";
import { vitalsDay, type VitalsDay } from "@/lib/db/schema";
import type { VitalsDayInput } from "./schema";
import type { VitalsDayView, VitalsPoint, VitalsRollup, VitalsTrend } from "./types";

/**
 * Vitals module — repository. The only place `vitals_day` is touched. Reads exclude soft-deleted.
 * All averages and trends are DERIVED here, never stored, so they cannot drift from the facts.
 *
 * No `bump("health")`: the panel's health section renders the weight card (panel-contract §4.2)
 * and knows nothing about vitals, so bumping would cause spurious refetches of a section that did
 * not change. Rides and lifting skip it for the same reason. If vitals ever reaches the panel,
 * that's when the bump is added.
 */

const live = isNull(vitalsDay.deletedAt);
const round1 = (n: number | null): number | null => (n == null ? null : Math.round(n * 10) / 10);

/** Strip the archive and the audit plumbing: one shape for list AND detail (issue #40). */
export function toView(row: VitalsDay): VitalsDayView {
  const { rawPayload: _raw, deletedAt: _del, ...rest } = row;
  return {
    ...rest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sleepStartAt: row.sleepStartAt?.toISOString() ?? null,
    sleepEndAt: row.sleepEndAt?.toISOString() ?? null,
  };
}

/** The measurement columns, in the order the model doc lists them. */
const MEASUREMENTS = [
  "sleepTotalSeconds", "sleepDeepSeconds", "sleepLightSeconds", "sleepRemSeconds", "sleepAwakeSeconds",
  "napSeconds", "sleepSpo2Avg", "sleepSpo2Low", "sleepRespirationAvg", "hrvLastNightMs",
  "hrvLastNight5MinHighMs", "restingHeartRate", "minHeartRate", "maxHeartRate", "spo2Avg", "spo2Low",
  "respirationWakingAvg", "respirationLow", "respirationHigh", "steps", "floorsAscended",
  "intensityMinutesModerate", "intensityMinutesVigorous",
] as const satisfies readonly (keyof VitalsDayView)[];

/** A row that exists but measured nothing is a gap, not data (watch never worn, never synced). */
function hasAnyMeasurement(row: Pick<VitalsDay, (typeof MEASUREMENTS)[number]>): boolean {
  return MEASUREMENTS.some((k) => row[k] != null);
}

// -- Write (one writer: the Garmin daemon) ------------------------------------

/**
 * Upsert one day. Garmin REVISES a day after the fact — sleep finalizes in the morning, resting HR
 * updates late — so the daemon re-polls a trailing window and the newest poll wins wholesale.
 *
 * Deliberately a full replace, not a merge: a merge would let a stale field from an earlier poll
 * survive a later one that legitimately cleared it, and there'd be no way to tell the two apart.
 */
export async function upsertDay(input: VitalsDayInput): Promise<{ row: VitalsDay; created: boolean }> {
  const values = {
    ...input,
    sleepStartAt: input.sleepStartAt ? new Date(input.sleepStartAt) : null,
    sleepEndAt: input.sleepEndAt ? new Date(input.sleepEndAt) : null,
  };
  const existing = await getDay(input.measuredOn);
  if (existing) {
    const [row] = await db
      .update(vitalsDay)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(vitalsDay.id, existing.id))
      .returning();
    return { row, created: false };
  }
  const [row] = await db.insert(vitalsDay).values(values).returning();
  return { row, created: true };
}

// -- Read ---------------------------------------------------------------------

export async function getDay(date: string): Promise<VitalsDay | null> {
  const [row] = await db
    .select()
    .from(vitalsDay)
    .where(and(eq(vitalsDay.measuredOn, date), live))
    .limit(1);
  return row ?? null;
}

export async function listDays(
  opts: { limit?: number; offset?: number; from?: string; to?: string } = {}
): Promise<{ items: VitalsDayView[]; count: number }> {
  const { limit = 50, offset = 0, from, to } = opts;
  const where = and(
    live,
    from ? gte(vitalsDay.measuredOn, from) : undefined,
    to ? lte(vitalsDay.measuredOn, to) : undefined
  );
  const items = await db
    .select()
    .from(vitalsDay)
    .where(where)
    .orderBy(desc(vitalsDay.measuredOn))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(vitalsDay).where(where);
  return { items: items.map(toView), count: c };
}

export async function softDeleteDay(date: string): Promise<boolean> {
  const [row] = await db
    .update(vitalsDay)
    .set({ deletedAt: new Date() })
    .where(and(eq(vitalsDay.measuredOn, date), live))
    .returning({ id: vitalsDay.id });
  return !!row;
}

export async function hardDeleteDay(date: string): Promise<boolean> {
  const [row] = await db
    .delete(vitalsDay)
    .where(eq(vitalsDay.measuredOn, date))
    .returning({ id: vitalsDay.id });
  return !!row;
}

/** The stored archive for a day — the input to reprocess, never part of a normal read. */
export async function getRawPayload(date: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ raw: vitalsDay.rawPayload })
    .from(vitalsDay)
    .where(and(eq(vitalsDay.measuredOn, date), live))
    .limit(1);
  return (row?.raw as Record<string, unknown> | undefined) ?? null;
}

// -- Rollup (derived trends) --------------------------------------------------

type TrendKey = "restingHeartRate" | "hrvLastNightMs" | "sleepTotalSeconds";

/**
 * The rollup: per-day series + 7-day trailing averages for the three metrics worth a trend, plus
 * the honest gap list.
 *
 * Rolling averages are gap-tolerant (average whatever days exist in the trailing 7) and the delta
 * compares this week's average to last week's — a day-over-day delta on any of these is noise, the
 * same lesson the weight module already learned. Nothing is interpolated across a gap: a missing
 * day stays missing, exactly as `RideCharts` leaves a null bucket's path open.
 */
export async function getRollup(opts: { window?: number; end?: string } = {}): Promise<VitalsRollup> {
  const window = opts.window ?? 30;

  const [bounds] = await db
    .select({ first: min(vitalsDay.measuredOn), last: max(vitalsDay.measuredOn) })
    .from(vitalsDay)
    .where(live);

  const emptyTrend: VitalsTrend = { current: null, currentAvg: null, deltaPerWeek: null, series: [] };
  if (!bounds?.last) {
    const to = opts.end ?? "";
    return {
      window,
      from: to,
      to,
      restingHeartRate: emptyTrend,
      hrvLastNightMs: emptyTrend,
      sleepTotalSeconds: emptyTrend,
      gaps: [],
    };
  }

  const end = opts.end ?? bounds.last;
  let start = addDays(end, -(window - 1));
  if (bounds.first && start < bounds.first) start = bounds.first; // clamp — no empty leading region

  // Fetch the window plus 6 trailing days: the rolling average at the window's first day needs them.
  const rows = await db
    .select()
    .from(vitalsDay)
    .where(and(live, gte(vitalsDay.measuredOn, addDays(start, -6)), lte(vitalsDay.measuredOn, end)))
    .orderBy(asc(vitalsDay.measuredOn));

  const byDate = new Map(rows.map((r) => [r.measuredOn, r]));
  const days = dateRange(start, end);

  const trendFor = (key: TrendKey): VitalsTrend => {
    const valueAt = (day: string): number | null => byDate.get(day)?.[key] ?? null;
    const avgAt = (day: string): number | null => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 7; i++) {
        const v = valueAt(addDays(day, -i));
        if (v != null) {
          sum += v;
          n += 1;
        }
      }
      return n ? sum / n : null;
    };

    const series: VitalsPoint[] = days.map((day) => ({
      date: day,
      value: valueAt(day),
      avg: round1(avgAt(day)),
    }));

    const currentAvg = avgAt(end);
    const priorAvg = avgAt(addDays(end, -7));
    return {
      current: valueAt(end),
      currentAvg: round1(currentAvg),
      deltaPerWeek: currentAvg != null && priorAvg != null ? round1(currentAvg - priorAvg) : null,
      series,
    };
  };

  // Gaps are factual absences, stated as observations, never judgments (CONVENTIONS §9).
  const gaps = days
    .map((day) => {
      const row = byDate.get(day);
      if (!row) return { date: day, reason: "no_row" as const };
      if (!hasAnyMeasurement(row)) return { date: day, reason: "no_measurements" as const };
      return null;
    })
    .filter((g): g is { date: string; reason: "no_row" | "no_measurements" } => g !== null);

  return {
    window,
    from: start,
    to: end,
    restingHeartRate: trendFor("restingHeartRate"),
    hrvLastNightMs: trendFor("hrvLastNightMs"),
    sleepTotalSeconds: trendFor("sleepTotalSeconds"),
    gaps,
  };
}
