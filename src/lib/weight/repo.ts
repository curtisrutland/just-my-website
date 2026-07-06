import { and, asc, count, desc, eq, gte, isNull, lte, max, min } from "drizzle-orm";
import { addDays, dateRange } from "@/lib/date";
import { db } from "@/lib/db";
import { weightEntry, type WeightEntry } from "@/lib/db/schema";
import type { WeightCreate, WeightPatch, WeightPoint, WeightRollup } from "./schema";

/**
 * Weight module — repository. The only place `weight_entry` is touched. Reads exclude soft-deleted.
 * The 7-day rolling average and trend are DERIVED here, never stored.
 */

const live = isNull(weightEntry.deletedAt);
const round1 = (n: number | null): number | null => (n == null ? null : Math.round(n * 10) / 10);

// -- CRUD ---------------------------------------------------------------------

/** Upsert the weight for a day (one live weight per day; re-logging replaces it). */
export async function setWeight(input: WeightCreate): Promise<WeightEntry> {
  const existing = await getEntryByDay(input.measuredOn);
  if (existing) {
    const [row] = await db
      .update(weightEntry)
      .set({ weight: input.weight, note: input.note ?? null })
      .where(eq(weightEntry.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(weightEntry)
    .values({ measuredOn: input.measuredOn, weight: input.weight, note: input.note ?? null })
    .returning();
  return row;
}

export async function getEntryByDay(date: string): Promise<WeightEntry | null> {
  const [row] = await db
    .select()
    .from(weightEntry)
    .where(and(eq(weightEntry.measuredOn, date), live))
    .limit(1);
  return row ?? null;
}

export async function getEntryById(id: string): Promise<WeightEntry | null> {
  const [row] = await db
    .select()
    .from(weightEntry)
    .where(and(eq(weightEntry.id, id), live))
    .limit(1);
  return row ?? null;
}

export async function listEntries(opts: { limit?: number; offset?: number } = {}): Promise<{ items: WeightEntry[]; count: number }> {
  const { limit = 50, offset = 0 } = opts;
  const items = await db
    .select()
    .from(weightEntry)
    .where(live)
    .orderBy(desc(weightEntry.measuredOn))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(weightEntry).where(live);
  return { items, count: c };
}

export async function patchEntry(id: string, patch: WeightPatch): Promise<WeightEntry | null> {
  if (Object.keys(patch).length === 0) return getEntryById(id);
  const [row] = await db
    .update(weightEntry)
    .set(patch)
    .where(and(eq(weightEntry.id, id), live))
    .returning();
  return row ?? null;
}

export async function softDeleteEntry(id: string): Promise<boolean> {
  const [row] = await db
    .update(weightEntry)
    .set({ deletedAt: new Date() })
    .where(and(eq(weightEntry.id, id), live))
    .returning({ id: weightEntry.id });
  return !!row;
}

export async function hardDeleteEntry(id: string): Promise<boolean> {
  const [row] = await db.delete(weightEntry).where(eq(weightEntry.id, id)).returning({ id: weightEntry.id });
  return !!row;
}

// -- Rollup (derived trend) ---------------------------------------------------

/**
 * The trend rollup: a per-day series (raw weight + 7-day trailing average) over a window ending at
 * the latest weigh-in, plus summary stats. The rolling average is gap-tolerant (averages whatever
 * days exist in the trailing 7). The trend rate is the change in that average vs. a week ago.
 */
export async function getRollup(opts: { window?: number; end?: string } = {}): Promise<WeightRollup> {
  const window = opts.window ?? 90;
  const empty: WeightRollup = {
    summary: { currentAvg: null, current: null, trendPerWeek: null, range: null, window },
    series: [],
  };

  // Data bounds (to resolve the default end and to clamp the window start — no empty leading region).
  const [bounds] = await db
    .select({ first: min(weightEntry.measuredOn), last: max(weightEntry.measuredOn) })
    .from(weightEntry)
    .where(live);
  if (!bounds?.last) return empty;

  const end = opts.end ?? bounds.last;
  let start = addDays(end, -(window - 1));
  if (bounds.first && start < bounds.first) start = bounds.first; // clamp to the first weigh-in
  // Fetch the window plus 6 trailing days (needed for the rolling average at the window's start).
  const rows = await db
    .select({ measuredOn: weightEntry.measuredOn, weight: weightEntry.weight })
    .from(weightEntry)
    .where(and(live, gte(weightEntry.measuredOn, addDays(start, -6)), lte(weightEntry.measuredOn, end)))
    .orderBy(asc(weightEntry.measuredOn));

  if (rows.length === 0) return empty;

  const byDate = new Map(rows.map((r) => [r.measuredOn, r.weight]));

  const avgAt = (day: string): number | null => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const w = byDate.get(addDays(day, -i));
      if (w != null) {
        sum += w;
        n += 1;
      }
    }
    return n ? sum / n : null;
  };

  const series: WeightPoint[] = dateRange(start, end).map((day) => ({
    date: day,
    weight: byDate.get(day) ?? null,
    avg: round1(avgAt(day)),
  }));

  const currentAvg = avgAt(end);
  const rawInWindow = series.map((p) => p.weight).filter((w): w is number => w != null);

  // Trend = least-squares slope of the rolling average across the window, in lb/week (window-aware).
  const avgPts = series
    .map((p, i) => ({ x: i, y: p.avg }))
    .filter((p): p is { x: number; y: number } => p.y != null);
  let trendPerWeek: number | null = null;
  if (avgPts.length >= 2) {
    const mx = avgPts.reduce((a, p) => a + p.x, 0) / avgPts.length;
    const my = avgPts.reduce((a, p) => a + p.y, 0) / avgPts.length;
    let num = 0;
    let den = 0;
    for (const p of avgPts) {
      num += (p.x - mx) * (p.y - my);
      den += (p.x - mx) ** 2;
    }
    trendPerWeek = den ? round1((num / den) * 7) : null;
  }

  return {
    summary: {
      currentAvg: round1(currentAvg),
      current: rows[rows.length - 1].weight,
      trendPerWeek,
      range: rawInWindow.length ? { min: Math.min(...rawInWindow), max: Math.max(...rawInWindow) } : null,
      window,
    },
    series,
  };
}
