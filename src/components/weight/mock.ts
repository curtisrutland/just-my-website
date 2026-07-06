import { addDays } from "@/components/macros/date";
import type { WeightPoint, WeightRollup } from "@/lib/weight/schema";

/** Deterministic ~90-day mock series for the dev preview: a gentle downward trend with daily noise
 *  and a few gaps. Keeps the preview off the database. */

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 90;
const END = "2026-07-05";
const START = addDays(END, -(N - 1));
const GAPS = new Set([2, 8, 15, 23, 38, 54, 71]);

function build(): WeightRollup {
  const rnd = rng(20260705);
  const days = Array.from({ length: N }, (_, i) => addDays(START, i));
  const raw: (number | null)[] = days.map((_, i) => {
    const daysAgo = N - 1 - i;
    if (GAPS.has(daysAgo)) return null;
    const base = 177.6 + (daysAgo / (N - 1)) * (183.2 - 177.6);
    const noise = (rnd() - 0.5) * 3 + (rnd() - 0.5) * 1.6;
    return Math.round((base + noise) * 10) / 10;
  });
  raw[N - 1] = 177.6;

  const avg: (number | null)[] = raw.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      if (raw[j] != null) {
        sum += raw[j] as number;
        n += 1;
      }
    }
    return n ? Math.round((sum / n) * 10) / 10 : null;
  });

  const series: WeightPoint[] = days.map((date, i) => ({ date, weight: raw[i], avg: avg[i] }));

  const pts = series.map((p, i) => ({ x: i, y: p.avg })).filter((p): p is { x: number; y: number } => p.y != null);
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const rawVals = raw.filter((w): w is number => w != null);

  return {
    summary: {
      currentAvg: avg[N - 1],
      current: 177.6,
      trendPerWeek: Math.round((num / den) * 7 * 10) / 10,
      range: { min: Math.min(...rawVals), max: Math.max(...rawVals) },
      window: N,
    },
    series,
  };
}

export const mockWeightRollup = build();
export const mockToday = END;

const NOTES: Record<string, string> = { "2026-07-05": "morning, fasted", "2026-07-01": "post-ride, low on water" };

/** Recent weigh-ins for the preview list (newest first), shaped like WeightEntry rows. */
export const mockWeightEntries = mockWeightRollup.series
  .filter((p): p is { date: string; weight: number; avg: number | null } => p.weight != null)
  .slice(-9)
  .reverse()
  .map((p, i) => ({
    id: `w${i}`,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    measuredOn: p.date,
    weight: p.weight,
    note: NOTES[p.date] ?? null,
  }));
