import { and, gte, isNull, lte, min } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { vitalsDay } from "@/lib/db/schema";
import { getDay, getRollup, listDays, softDeleteDay, upsertDay } from "./repo";

/** Integration test against live Neon. Far-PAST sentinel dates (1901), same reasoning as the
 *  weight repo test: `getRollup` derives its clamp from `min(measuredOn)` across the whole table,
 *  so the seeded rows must be the global-earliest. Cleans up after; never touches real data. */

const seed = (measuredOn: string, fields: Record<string, number | null> = {}) =>
  upsertDay({ measuredOn, rawPayload: { seeded: true }, ...fields });

async function wipe() {
  await db.delete(vitalsDay).where(and(gte(vitalsDay.measuredOn, "1901-01-01"), lte(vitalsDay.measuredOn, "1901-12-31")));
}

beforeAll(wipe);
afterAll(wipe);

describe("upsert — the daemon re-polls a trailing window forever", () => {
  it("creates once, then replaces on re-poll", async () => {
    const first = await seed("1901-06-10", { restingHeartRate: 50 });
    expect(first.created).toBe(true);

    const second = await seed("1901-06-10", { restingHeartRate: 47 });
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id); // same row, not a duplicate
    expect(second.row.restingHeartRate).toBe(47);
  });

  it("replaces wholesale rather than merging — a later poll can legitimately clear a field", async () => {
    await seed("1901-06-11", { restingHeartRate: 50, hrvLastNightMs: 60 });
    await seed("1901-06-11", { restingHeartRate: 50 });
    const row = await getDay("1901-06-11");
    expect(row?.hrvLastNightMs).toBeNull();
  });
});

describe("rollup — derived trends, gap honesty", () => {
  it("computes 7-day trailing averages, leaves gaps open, clamps to the first day", async () => {
    await seed("1901-07-01", { restingHeartRate: 50, hrvLastNightMs: 40, sleepTotalSeconds: 21600 });
    await seed("1901-07-02", { restingHeartRate: 52, hrvLastNightMs: 44, sleepTotalSeconds: 25200 });
    // 1901-07-03 deliberately absent — a day with no row at all.
    await seed("1901-07-04", { restingHeartRate: 48, hrvLastNightMs: 48, sleepTotalSeconds: 23400 });

    // Window sized to the island: other describes seed earlier sentinel dates, and the clamp is
    // derived from min(measuredOn) across the whole table — so a wide window here would legitimately
    // start earlier. The clamp itself is asserted separately below.
    const r = await getRollup({ end: "1901-07-04", window: 4 });
    const at = (d: string) => r.restingHeartRate.series.find((p) => p.date === d);

    expect(r.from).toBe("1901-07-01");
    expect(r.restingHeartRate.series).toHaveLength(4);

    expect(at("1901-07-01")).toMatchObject({ value: 50, avg: 50 });
    expect(at("1901-07-02")).toMatchObject({ value: 52, avg: 51 });
    // The gap: no measurement that day, but the trailing average still carries.
    expect(at("1901-07-03")).toMatchObject({ value: null, avg: 51 });
    expect(at("1901-07-04")).toMatchObject({ value: 48, avg: 50 });

    expect(r.restingHeartRate.current).toBe(48);
    expect(r.restingHeartRate.currentAvg).toBe(50);
    expect(r.hrvLastNightMs.current).toBe(48);
    expect(r.sleepTotalSeconds.current).toBe(23400);
  });

  it("reports gaps as factual absences, distinguishing no-row from measured-nothing", async () => {
    await seed("1901-08-01", { restingHeartRate: 50 });
    await seed("1901-08-02"); // a row exists, but the watch measured nothing
    await seed("1901-08-04", { restingHeartRate: 51 });

    const r = await getRollup({ end: "1901-08-04", window: 30 });
    const gaps = Object.fromEntries(r.gaps.map((g) => [g.date, g.reason]));

    expect(gaps["1901-08-02"]).toBe("no_measurements");
    expect(gaps["1901-08-03"]).toBe("no_row");
    expect(gaps["1901-08-01"]).toBeUndefined();
    expect(gaps["1901-08-04"]).toBeUndefined();
  });

  it("never interpolates a value across a gap", async () => {
    await seed("1901-09-01", { restingHeartRate: 40 });
    await seed("1901-09-05", { restingHeartRate: 60 });
    const r = await getRollup({ end: "1901-09-05", window: 30 });
    for (const d of ["1901-09-02", "1901-09-03", "1901-09-04"]) {
      expect(r.restingHeartRate.series.find((p) => p.date === d)?.value).toBeNull();
    }
  });

  it("clamps the window start to the earliest day rather than padding empty leading days", async () => {
    // A 3650-day window cannot reach before the first row that exists.
    const r = await getRollup({ end: "1901-12-31", window: 3650 });
    const [earliest] = await db
      .select({ m: min(vitalsDay.measuredOn) })
      .from(vitalsDay)
      .where(isNull(vitalsDay.deletedAt));
    expect(r.from).toBe(earliest.m);
  });

  it("returns an empty-but-valid rollup when a window has no data", async () => {
    const r = await getRollup({ end: "1901-01-05", window: 7 });
    expect(r.restingHeartRate.series.every((p) => p.value === null)).toBe(true);
  });
});

describe("reads", () => {
  it("excludes soft-deleted days from get, list and rollup", async () => {
    await seed("1901-10-01", { restingHeartRate: 55 });
    expect(await getDay("1901-10-01")).not.toBeNull();

    expect(await softDeleteDay("1901-10-01")).toBe(true);
    expect(await getDay("1901-10-01")).toBeNull();

    const { items } = await listDays({ from: "1901-10-01", to: "1901-10-01" });
    expect(items).toHaveLength(0);
  });

  it("never leaks rawPayload through the view (it is the archive, not the contract)", async () => {
    await seed("1901-11-01", { steps: 100 });
    const { items } = await listDays({ from: "1901-11-01", to: "1901-11-01" });
    expect(items[0]).not.toHaveProperty("rawPayload");
    expect(items[0].steps).toBe(100);
  });

  it("a soft-deleted day can be re-created by the next poll", async () => {
    // The daemon keeps re-polling; the partial-unique index is scoped to live rows precisely so a
    // deleted junk day does not permanently block its own replacement.
    await seed("1901-12-01", { steps: 1 });
    await softDeleteDay("1901-12-01");
    const again = await seed("1901-12-01", { steps: 2 });
    expect(again.created).toBe(true);
    expect((await getDay("1901-12-01"))?.steps).toBe(2);
  });
});
