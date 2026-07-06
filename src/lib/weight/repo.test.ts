import { and, gte, lte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { weightEntry } from "@/lib/db/schema";
import { getEntryByDay, getRollup, listEntries, setWeight, softDeleteEntry } from "./repo";

/** Integration test against live Neon. Far-future sentinel dates; cleans up after. */

const seed = (measuredOn: string, weight: number) => setWeight({ measuredOn, weight });

async function wipe() {
  await db.delete(weightEntry).where(and(gte(weightEntry.measuredOn, "2999-01-01"), lte(weightEntry.measuredOn, "2999-12-31")));
}

beforeAll(wipe);
afterAll(wipe);

describe("rollup: rolling average, gaps, clamp", () => {
  it("computes the 7-day trailing average, carries through gaps, clamps to the first entry", async () => {
    await seed("2999-06-01", 200);
    await seed("2999-06-02", 202);
    // 2999-06-03 skipped (a gap)
    await seed("2999-06-04", 204);

    const r = await getRollup({ end: "2999-06-04", window: 30 });
    const at = (d: string) => r.series.find((p) => p.date === d);

    // Clamped to the first weigh-in (not padded back 30 days).
    expect(r.series[0].date).toBe("2999-06-01");
    expect(r.series).toHaveLength(4);
    expect(at("2999-06-01")).toMatchObject({ weight: 200, avg: 200 });
    expect(at("2999-06-02")).toMatchObject({ weight: 202, avg: 201 });
    expect(at("2999-06-03")).toMatchObject({ weight: null, avg: 201 }); // gap: no raw, avg carries
    expect(at("2999-06-04")).toMatchObject({ weight: 204, avg: 202 });

    expect(r.summary.current).toBe(204);
    expect(r.summary.currentAvg).toBe(202);
    expect(r.summary.range).toEqual({ min: 200, max: 204 });
    expect(r.summary.trendPerWeek).toBeGreaterThan(0); // rising
  });
});

describe("rollup: trend = least-squares slope (lb/wk)", () => {
  it("is negative for a declining series, positive for a rising one", async () => {
    for (let d = 1; d <= 10; d++) await seed(`2999-07-${String(d).padStart(2, "0")}`, 200 - d); // 199 → 190
    const down = await getRollup({ end: "2999-07-10", window: 20 });
    expect(down.summary.trendPerWeek).toBeLessThan(0);

    for (let d = 1; d <= 10; d++) await seed(`2999-08-${String(d).padStart(2, "0")}`, 180 + d); // 181 → 190
    const up = await getRollup({ end: "2999-08-10", window: 20 });
    expect(up.summary.trendPerWeek).toBeGreaterThan(0);
  });
});

describe("one weight per day (upsert)", () => {
  it("re-logging a day replaces it", async () => {
    await seed("2999-10-10", 190);
    await seed("2999-10-10", 195);
    expect((await getEntryByDay("2999-10-10"))?.weight).toBe(195);
    const list = await listEntries({ limit: 100 });
    expect(list.items.filter((x) => x.measuredOn === "2999-10-10")).toHaveLength(1);
  });
});

describe("soft-delete", () => {
  it("removes the day from reads and shows a gap in the rollup", async () => {
    await seed("2999-09-04", 168);
    const mid = await seed("2999-09-05", 170);
    await seed("2999-09-06", 172);
    await softDeleteEntry(mid.id);

    expect(await getEntryByDay("2999-09-05")).toBeNull();
    const r = await getRollup({ end: "2999-09-06", window: 5 });
    expect(r.series.find((p) => p.date === "2999-09-05")?.weight).toBeNull();
  });
});
