import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { garageBike, garageProfile, garageRide } from "@/lib/db/schema";
import {
  attribute,
  createBike,
  createRideTag,
  getBike,
  GarageError,
  listRideTags,
  patchBike,
  patchRideTag,
  tagsForActivities,
} from "./repo";
import type { RideFacts } from "./schema";

/**
 * Integration test against live Neon. Test bikes are named `__test__…` and claim `__T_…` profiles,
 * so they never collide with real bikes or rules; ride ids are random. Cleanup hard-deletes only
 * those rows.
 */
const T = "__test__";
const P = "__T_";

async function wipe() {
  const bikes = await db.select({ id: garageBike.id }).from(garageBike).where(like(garageBike.name, `${T}%`));
  const ids = bikes.map((b) => b.id);
  if (ids.length) {
    await db.delete(garageRide).where(inArray(garageRide.bikeId, ids));
    await db.delete(garageProfile).where(inArray(garageProfile.bikeId, ids));
    await db.delete(garageBike).where(inArray(garageBike.id, ids));
  }
}

beforeAll(wipe);
afterAll(wipe);

const ride = (profile: string | null, over: Partial<RideFacts> = {}): RideFacts => ({
  activityId: randomUUID(),
  localDate: "1990-06-01",
  startedAt: "1990-06-01T15:00:00.000Z",
  sportProfileName: profile,
  movingSeconds: 3600,
  distanceMeters: 20000,
  ...over,
});

const expectRefusal = async (p: Promise<unknown>, status: 404 | 409) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(GarageError);
  expect((e as GarageError).status).toBe(status);
};

describe("bikes", () => {
  it("defaults the nickname to the model and keeps the profile spellings", async () => {
    const bike = await createBike({ brand: "Test", model: `${T}Model A`, modelYear: 2026, profiles: [`${P}ONE`] });
    expect(bike.name).toBe(`${T}Model A`);
    expect(bike.profiles).toEqual([`${P}ONE`]);
    expect(bike.rides).toBe(0);
    expect(bike.lastRiddenOn).toBeNull();
  });

  it("refuses a duplicate nickname (case-insensitive) and a profile another bike claims", async () => {
    await expectRefusal(createBike({ name: `${T}MODEL A`, brand: "x", model: "y", modelYear: 2026 }), 409);
    await expectRefusal(createBike({ name: `${T}other`, brand: "x", model: "y", modelYear: 2026, profiles: [`${P}one`] }), 409);
  });
});

describe("attribute: rules tag, people win", () => {
  it("tags by rule (case-insensitive), is idempotent, and reports unmatched rides", async () => {
    const bike = await createBike({ name: `${T}rule bike`, brand: "x", model: "y", modelYear: 2026, profiles: [`${P}GRAVEL`] });
    const a = ride(`${P}gravel`);
    const b = ride(`${P}nothing`);
    const first = await attribute([a, b]);
    expect(first.tagged.map((t) => [t.activityId, t.bikeId, t.assignedBy, t.reason])).toEqual([[a.activityId, bike.id, "rule", `${P}gravel`]]);
    expect(first.unmatched).toEqual([b.activityId]);

    const again = await attribute([a]);
    expect(again.tagged).toEqual([]);
    expect(again.unchanged).toEqual([a.activityId]);

    const totals = await getBike(bike.id);
    expect(totals).toMatchObject({ rides: 1, movingSeconds: 3600, distanceMeters: 20000, lastRiddenOn: "1990-06-01" });
  });

  it("never touches a manual tag, even when a rule names another bike", async () => {
    const ruled = await createBike({ name: `${T}ruled`, brand: "x", model: "y", modelYear: 2026, profiles: [`${P}MTB`] });
    const mine = await createBike({ name: `${T}mine`, brand: "x", model: "y", modelYear: 2026 });
    const r = ride(`${P}MTB`);
    await createRideTag({ ...r, bikeId: mine.id });
    const result = await attribute([r]);
    expect(result.unchanged).toEqual([r.activityId]);
    expect((await tagsForActivities([r.activityId])).get(r.activityId)?.bikeId).toBe(mine.id);
    expect((await getBike(ruled.id))!.rides).toBe(0);
  });

  it("moving a profile to another bike: removal untags its rule tags, the next sweep re-tags them", async () => {
    const from = await createBike({ name: `${T}from`, brand: "x", model: "y", modelYear: 2026, profiles: [`${P}MOVE`] });
    const to = await createBike({ name: `${T}to`, brand: "x", model: "y", modelYear: 2026 });
    const r = ride(`${P}MOVE`);
    await attribute([r]);
    await patchBike(from.id, { profiles: [] });
    expect((await tagsForActivities([r.activityId])).has(r.activityId)).toBe(false);
    await patchBike(to.id, { profiles: [`${P}MOVE`] });
    const swept = await attribute([r]);
    expect(swept.tagged[0]).toMatchObject({ bikeId: to.id, assignedBy: "rule" });
  });

  it("retiring a bike drops its rules but keeps its rides, through later sweeps too", async () => {
    const bike = await createBike({ name: `${T}old`, brand: "x", model: "y", modelYear: 2020, profiles: [`${P}OLD`] });
    const r = ride(`${P}OLD`);
    await attribute([r]);
    const retired = await patchBike(bike.id, { retiredOn: "1990-07-01" });
    expect(retired).toMatchObject({ profiles: [], rides: 1, retiredOn: "1990-07-01" });
    const swept = await attribute([r]);
    expect(swept.unchanged).toEqual([r.activityId]);
    await expectRefusal(createRideTag({ ...ride(null), bikeId: bike.id }), 409); // offered for no new tags
  });
});

describe("hand tags", () => {
  it("replays the same tag, refuses another bike, and a move makes it manual", async () => {
    const a = await createBike({ name: `${T}hand a`, brand: "x", model: "y", modelYear: 2026 });
    const b = await createBike({ name: `${T}hand b`, brand: "x", model: "y", modelYear: 2026 });
    const r = ride("MTB");
    const first = await createRideTag({ ...r, bikeId: a.id, assignedBy: "backfill", reason: "named in the ride" });
    expect(first).toMatchObject({ replay: false, tag: { assignedBy: "backfill", reason: "named in the ride" } });
    expect((await createRideTag({ ...r, bikeId: a.id })).replay).toBe(true);
    await expectRefusal(createRideTag({ ...r, bikeId: b.id }), 409);

    const moved = await patchRideTag(first.tag.id, { bikeId: b.id });
    expect(moved).toMatchObject({ bikeId: b.id, assignedBy: "manual", reason: null });
    const { items } = await listRideTags({ bikeId: b.id });
    expect(items.map((t) => t.activityId)).toContain(r.activityId);
  });

  it("refuses an unknown bike", async () => {
    await expectRefusal(createRideTag({ ...ride(null), bikeId: randomUUID() }), 404);
  });
});
