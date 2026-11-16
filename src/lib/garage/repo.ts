import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, lte, max, sql, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { garageBike, garageProfile, garageRide, type GarageBike, type GarageRide } from "@/lib/db/schema";
import { decideAttribution, diffProfiles, normalizeProfile, type ExistingTag, type RuleMap } from "./rules";
import {
  rideTagCreateSchema,
  type AssignedBy,
  type BikeCreate,
  type BikePatch,
  type RideFacts,
  type RideTagCreate,
  type RideTagPatch,
} from "./schema";
import type { AttributeResult, BikeView, RideTagView } from "./types";

/**
 * Garage module — repository (docs/garage-model.md). The only place the `garage_*` tables are
 * touched. Reads exclude soft-deleted rows. Per-bike totals are derived from the live ride tags'
 * copied facts, never stored, and never read from the rides module (CONVENTIONS §9).
 *
 * neon-http has no interactive transactions, so multi-statement writes go through `db.batch`
 * (one transaction), with ids generated up front where a later statement needs them.
 */

/** A write the garage refuses: an unknown row (404) or a uniqueness clash (409). Routes map it. */
export class GarageError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string
  ) {
    super(message);
  }
}

const liveBike = isNull(garageBike.deletedAt);
const liveProfile = isNull(garageProfile.deletedAt);
const liveRide = isNull(garageRide.deletedAt);

// -- Views --------------------------------------------------------------------

type Totals = { rides: number; movingSeconds: number; distanceMeters: number; lastRiddenOn: string | null };
const NO_TOTALS: Totals = { rides: 0, movingSeconds: 0, distanceMeters: 0, lastRiddenOn: null };

function toBikeView(row: GarageBike, profiles: string[], totals: Totals): BikeView {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    model: row.model,
    modelYear: row.modelYear,
    note: row.note,
    retiredOn: row.retiredOn,
    profiles,
    ...totals,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toRideTagView(row: GarageRide): RideTagView {
  return {
    id: row.id,
    activityId: row.activityId,
    bikeId: row.bikeId,
    assignedBy: row.assignedBy as AssignedBy,
    reason: row.reason,
    localDate: row.localDate,
    startedAt: row.startedAt.toISOString(),
    sportProfileName: row.sportProfileName,
    movingSeconds: row.movingSeconds,
    distanceMeters: row.distanceMeters,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Assemble views for these bike rows: their live profiles and their derived ride totals. */
async function withProfilesAndTotals(rows: GarageBike[]): Promise<BikeView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const profiles = await db
    .select({ bikeId: garageProfile.bikeId, profile: garageProfile.profile })
    .from(garageProfile)
    .where(and(liveProfile, inArray(garageProfile.bikeId, ids)))
    .orderBy(garageProfile.profile);
  const totals = await db
    .select({
      bikeId: garageRide.bikeId,
      rides: count(),
      movingSeconds: sum(garageRide.movingSeconds),
      distanceMeters: sum(garageRide.distanceMeters),
      lastRiddenOn: max(garageRide.localDate),
    })
    .from(garageRide)
    .where(and(liveRide, inArray(garageRide.bikeId, ids)))
    .groupBy(garageRide.bikeId);
  const totalsBy = new Map(
    totals.map((t) => [
      t.bikeId,
      {
        rides: t.rides,
        movingSeconds: Number(t.movingSeconds ?? 0),
        distanceMeters: Number(t.distanceMeters ?? 0),
        lastRiddenOn: t.lastRiddenOn,
      },
    ])
  );
  return rows.map((row) =>
    toBikeView(
      row,
      profiles.filter((p) => p.bikeId === row.id).map((p) => p.profile),
      totalsBy.get(row.id) ?? NO_TOTALS
    )
  );
}

// -- Bikes --------------------------------------------------------------------

/** Live bikes, active first then retired, each by name. Retired bikes only when asked. */
export async function listBikes({ includeRetired = false } = {}): Promise<BikeView[]> {
  const rows = await db
    .select()
    .from(garageBike)
    .where(includeRetired ? liveBike : and(liveBike, isNull(garageBike.retiredOn)))
    .orderBy(sql`${garageBike.retiredOn} is not null`, sql`lower(${garageBike.name})`);
  return withProfilesAndTotals(rows);
}

async function getBikeRow(id: string): Promise<GarageBike | null> {
  const [row] = await db.select().from(garageBike).where(and(eq(garageBike.id, id), liveBike)).limit(1);
  return row ?? null;
}

export async function getBike(id: string): Promise<BikeView | null> {
  const row = await getBikeRow(id);
  return row ? (await withProfilesAndTotals([row]))[0] : null;
}

async function assertNameFree(name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: garageBike.id })
    .from(garageBike)
    .where(and(liveBike, sql`lower(${garageBike.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (clash && clash.id !== exceptId) throw new GarageError(409, `A bike named "${name}" already exists`);
}

/** lower(profile) → the name of the live bike that claims it, excluding `exceptBikeId`. */
async function claimedProfiles(exceptBikeId?: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ profile: garageProfile.profile, bikeId: garageProfile.bikeId, name: garageBike.name })
    .from(garageProfile)
    .innerJoin(garageBike, eq(garageBike.id, garageProfile.bikeId))
    .where(and(liveProfile, liveBike));
  return new Map(rows.filter((r) => r.bikeId !== exceptBikeId).map((r) => [normalizeProfile(r.profile), r.name]));
}

function conflictMessage(conflicts: { profile: string; bikeName: string }[]): string {
  return conflicts.map((c) => `Profile "${c.profile}" already belongs to ${c.bikeName}`).join("; ");
}

/** Add a bike (nickname defaults to the model) with its profile rules. */
export async function createBike(input: BikeCreate): Promise<BikeView> {
  const name = input.name ?? input.model;
  await assertNameFree(name);
  const { add, conflicts } = diffProfiles([], input.profiles ?? [], await claimedProfiles());
  if (conflicts.length) throw new GarageError(409, conflictMessage(conflicts));

  const id = randomUUID();
  const insertBike = db.insert(garageBike).values({
    id,
    name,
    brand: input.brand,
    model: input.model,
    modelYear: input.modelYear,
    note: input.note ?? null,
  });
  if (add.length) {
    await db.batch([insertBike, db.insert(garageProfile).values(add.map((profile) => ({ profile, bikeId: id })))]);
  } else {
    await insertBike;
  }
  return (await getBike(id))!;
}

/**
 * Edit a bike. `profiles` replaces its rule set: a removed profile also removes the rule tags it
 * made (a person's tags stay). Retiring (`retiredOn` set) drops every rule but keeps all the
 * bike's tags — its history stays put.
 */
export async function patchBike(id: string, patch: BikePatch): Promise<BikeView | null> {
  const row = await getBikeRow(id);
  if (!row) return null;
  if (patch.name !== undefined) await assertNameFree(patch.name, id);

  const set: Partial<typeof garageBike.$inferInsert> = {};
  for (const key of ["name", "brand", "model", "modelYear", "note", "retiredOn"] as const) {
    if (patch[key] !== undefined) (set as Record<string, unknown>)[key] = patch[key];
  }
  const retiring = patch.retiredOn != null && row.retiredOn == null;
  const retired = patch.retiredOn !== undefined ? patch.retiredOn != null : row.retiredOn != null;

  const now = new Date();
  const statements = [];
  if (Object.keys(set).length) statements.push(db.update(garageBike).set(set).where(eq(garageBike.id, id)));

  if (retiring) {
    statements.push(
      db.update(garageProfile).set({ deletedAt: now }).where(and(eq(garageProfile.bikeId, id), liveProfile))
    );
  } else if (patch.profiles !== undefined) {
    if (retired && patch.profiles.length) throw new GarageError(409, "A retired bike can't claim profiles");
    const current = await db
      .select({ profile: garageProfile.profile })
      .from(garageProfile)
      .where(and(eq(garageProfile.bikeId, id), liveProfile));
    const { add, remove, conflicts } = diffProfiles(
      current.map((c) => c.profile),
      patch.profiles,
      await claimedProfiles(id)
    );
    if (conflicts.length) throw new GarageError(409, conflictMessage(conflicts));
    if (remove.length) {
      const removed = remove.map(normalizeProfile);
      statements.push(
        db
          .update(garageProfile)
          .set({ deletedAt: now })
          .where(and(eq(garageProfile.bikeId, id), liveProfile, inArray(sql`lower(${garageProfile.profile})`, removed))),
        // The rule tags those profiles made go with them; manual and backfill tags stay.
        db
          .update(garageRide)
          .set({ deletedAt: now })
          .where(
            and(
              eq(garageRide.bikeId, id),
              liveRide,
              eq(garageRide.assignedBy, "rule"),
              inArray(sql`lower(${garageRide.reason})`, removed)
            )
          )
      );
    }
    if (add.length) statements.push(db.insert(garageProfile).values(add.map((profile) => ({ profile, bikeId: id }))));
  }

  if (statements.length === 1) await statements[0];
  else if (statements.length > 1) await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  return getBike(id);
}

/** Soft-delete a bike along with its profiles and ride tags (they'd point at nothing). */
export async function softDeleteBike(id: string): Promise<boolean> {
  if (!(await getBikeRow(id))) return false;
  const now = new Date();
  await db.batch([
    db.update(garageProfile).set({ deletedAt: now }).where(and(eq(garageProfile.bikeId, id), liveProfile)),
    db.update(garageRide).set({ deletedAt: now }).where(and(eq(garageRide.bikeId, id), liveRide)),
    db.update(garageBike).set({ deletedAt: now }).where(eq(garageBike.id, id)),
  ]);
  return true;
}

export async function hardDeleteBike(id: string): Promise<boolean> {
  const [row] = await db.select({ id: garageBike.id }).from(garageBike).where(eq(garageBike.id, id)).limit(1);
  if (!row) return false;
  await db.batch([
    db.delete(garageProfile).where(eq(garageProfile.bikeId, id)),
    db.delete(garageRide).where(eq(garageRide.bikeId, id)),
    db.delete(garageBike).where(eq(garageBike.id, id)),
  ]);
  return true;
}

// -- Ride tags ----------------------------------------------------------------

export async function listRideTags(
  query: { bikeId?: string; activityId?: string; from?: string; to?: string },
  { limit = 50, offset = 0 } = {}
): Promise<{ items: RideTagView[]; count: number }> {
  const where = and(
    liveRide,
    query.bikeId ? eq(garageRide.bikeId, query.bikeId) : undefined,
    query.activityId ? eq(garageRide.activityId, query.activityId) : undefined,
    query.from ? gte(garageRide.localDate, query.from) : undefined,
    query.to ? lte(garageRide.localDate, query.to) : undefined
  );
  const rows = await db
    .select()
    .from(garageRide)
    .where(where)
    .orderBy(desc(garageRide.startedAt))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(garageRide).where(where);
  return { items: rows.map(toRideTagView), count: c };
}

/** The live tag for each of these rides, keyed by activityId — how the rides pages show the bike. */
export async function tagsForActivities(activityIds: string[]): Promise<Map<string, RideTagView>> {
  if (activityIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(garageRide)
    .where(and(liveRide, inArray(garageRide.activityId, activityIds)));
  return new Map(rows.map((r) => [r.activityId, toRideTagView(r)]));
}

async function getRideTagRow(id: string): Promise<GarageRide | null> {
  const [row] = await db.select().from(garageRide).where(and(eq(garageRide.id, id), liveRide)).limit(1);
  return row ?? null;
}

async function assertTaggable(bikeId: string) {
  const bike = await getBikeRow(bikeId);
  if (!bike) throw new GarageError(404, "Bike not found");
  if (bike.retiredOn) throw new GarageError(409, `${bike.name} is retired`);
}

function factsColumns(facts: RideFacts) {
  return {
    activityId: facts.activityId,
    localDate: facts.localDate,
    startedAt: new Date(facts.startedAt),
    sportProfileName: facts.sportProfileName,
    movingSeconds: facts.movingSeconds,
    distanceMeters: facts.distanceMeters,
  };
}

/**
 * Tag a ride by hand (or by the backfill). Idempotent per ride: already on this bike → the existing
 * tag (`replay: true`); on another bike → 409, because moving a ride is a PATCH.
 */
export async function createRideTag(input: RideTagCreate): Promise<{ tag: RideTagView; replay: boolean }> {
  const parsed = rideTagCreateSchema.parse(input);
  const [existing] = await db
    .select()
    .from(garageRide)
    .where(and(liveRide, eq(garageRide.activityId, parsed.activityId)))
    .limit(1);
  if (existing) {
    if (existing.bikeId === parsed.bikeId) return { tag: toRideTagView(existing), replay: true };
    const [other] = await db.select({ name: garageBike.name }).from(garageBike).where(eq(garageBike.id, existing.bikeId));
    throw new GarageError(409, `This ride is already tagged ${other?.name ?? "to another bike"}; move it instead`);
  }
  await assertTaggable(parsed.bikeId);
  const [row] = await db
    .insert(garageRide)
    .values({
      ...factsColumns(parsed),
      bikeId: parsed.bikeId,
      assignedBy: parsed.assignedBy,
      reason: parsed.assignedBy === "backfill" ? (parsed.reason ?? null) : null,
    })
    .returning();
  return { tag: toRideTagView(row), replay: false };
}

/** Move a tagged ride to another bike. A person moved it, so it becomes `manual`. */
export async function patchRideTag(id: string, patch: RideTagPatch): Promise<RideTagView | null> {
  if (!(await getRideTagRow(id))) return null;
  await assertTaggable(patch.bikeId);
  const [row] = await db
    .update(garageRide)
    .set({ bikeId: patch.bikeId, assignedBy: "manual", reason: null })
    .where(and(eq(garageRide.id, id), liveRide))
    .returning();
  return row ? toRideTagView(row) : null;
}

/** Untag a ride. */
export async function softDeleteRideTag(id: string): Promise<boolean> {
  const [row] = await db
    .update(garageRide)
    .set({ deletedAt: new Date() })
    .where(and(eq(garageRide.id, id), liveRide))
    .returning({ id: garageRide.id });
  return !!row;
}

export async function hardDeleteRideTag(id: string): Promise<boolean> {
  const [row] = await db.delete(garageRide).where(eq(garageRide.id, id)).returning({ id: garageRide.id });
  return !!row;
}

// -- Auto-tagging -------------------------------------------------------------

/** Live rules on non-retired bikes. */
async function loadRules(): Promise<RuleMap> {
  const rows = await db
    .select({ profile: garageProfile.profile, bikeId: garageProfile.bikeId })
    .from(garageProfile)
    .innerJoin(garageBike, eq(garageBike.id, garageProfile.bikeId))
    .where(and(liveProfile, liveBike, isNull(garageBike.retiredOn)));
  return new Map(rows.map((r) => [normalizeProfile(r.profile), r.bikeId]));
}

/**
 * Apply the profile rules to rides handed over by a caller that holds them (the daemon after
 * upload, the web upload, the /garage sweep). Idempotent: re-sending a ride changes nothing unless
 * a rule changed. Manual and backfill tags are never touched (`decideAttribution`).
 */
export async function attribute(rides: RideFacts[]): Promise<AttributeResult> {
  const rules = await loadRules();
  const ids = [...new Set(rides.map((r) => r.activityId))];
  const existingRows = await db
    .select({ tag: garageRide, retiredOn: garageBike.retiredOn })
    .from(garageRide)
    .innerJoin(garageBike, eq(garageBike.id, garageRide.bikeId))
    .where(and(liveRide, inArray(garageRide.activityId, ids)));
  const existing = new Map(existingRows.map((r) => [r.tag.activityId, r]));

  const result: AttributeResult = { tagged: [], unchanged: [], unmatched: [] };
  const seen = new Set<string>();
  for (const ride of rides) {
    if (seen.has(ride.activityId)) continue;
    seen.add(ride.activityId);
    const current = existing.get(ride.activityId);
    const tag: ExistingTag | undefined = current && {
      bikeId: current.tag.bikeId,
      assignedBy: current.tag.assignedBy as AssignedBy,
      bikeRetired: current.retiredOn != null,
    };
    const decision = decideAttribution(ride.sportProfileName, tag, rules);
    switch (decision.action) {
      case "unchanged":
        result.unchanged.push(ride.activityId);
        break;
      case "unmatched":
        result.unmatched.push(ride.activityId);
        break;
      case "untag":
        await softDeleteRideTag(current!.tag.id);
        result.unmatched.push(ride.activityId);
        break;
      case "tag": {
        const values = { ...factsColumns(ride), bikeId: decision.bikeId, assignedBy: "rule", reason: decision.reason };
        const [row] = current
          ? await db.update(garageRide).set(values).where(eq(garageRide.id, current.tag.id)).returning()
          : await db.insert(garageRide).values(values).returning();
        result.tagged.push(toRideTagView(row));
        break;
      }
    }
  }
  return result;
}
