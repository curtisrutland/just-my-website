import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { ride, rideStream, type Ride } from "@/lib/db/schema";
import type { FitRide } from "./schema";
import type { RideDetail, RideStreamView, RideView, TimeInHrZone, WeeklyStats } from "./types";

/**
 * Rides repo — the ONLY place `ride` / `ride_stream` are touched (CONVENTIONS §1). Reads
 * exclude soft-deleted rows. The fact columns are written by exactly two paths — ingest and
 * reprocess — both fed by `fitRideSchema.parse`d input; the surfaces can only ever reach
 * `patchRide` (name/note) and the delete pair.
 *
 * neon-http has no interactive transactions; multi-statement writes use `db.batch` (runs as
 * one transaction), with parent ids pre-generated — the lifting pattern.
 */

const live = () => isNull(ride.deletedAt);

// --- View mapping ---

/** The one view schema every read surface shares (field-parity rule). Storage-only columns
 *  (fileHash, blobKey, deviceSerial, rawSession) stay out of the contract. */
export function rideToView(row: Ride): RideView {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    sport: row.sport,
    subSport: row.subSport,
    sportProfileName: row.sportProfileName,
    startedAt: row.startedAt.toISOString(),
    localDate: row.localDate,
    elapsedSeconds: row.elapsedSeconds,
    movingSeconds: row.movingSeconds,
    distanceMeters: row.distanceMeters,
    totalAscentMeters: row.totalAscentMeters,
    totalDescentMeters: row.totalDescentMeters,
    avgPowerWatts: row.avgPowerWatts,
    maxPowerWatts: row.maxPowerWatts,
    normalizedPowerWatts: row.normalizedPowerWatts,
    avgHeartRate: row.avgHeartRate,
    maxHeartRate: row.maxHeartRate,
    avgCadence: row.avgCadence,
    maxCadence: row.maxCadence,
    avgSpeedMps: row.avgSpeedMps,
    maxSpeedMps: row.maxSpeedMps,
    calories: row.calories,
    avgTemperatureC: row.avgTemperatureC,
    timeInHrZone: (row.timeInHrZone as TimeInHrZone | null) ?? null,
    deviceManufacturer: row.deviceManufacturer,
    deviceProduct: row.deviceProduct,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Dedupe + ingest writes (fed only by fitRideSchema-validated input) ---

/**
 * The dedupe check, both keys: exact bytes (`fileHash`), or the same activity re-exported with
 * different bytes (`startedAt` + `deviceSerial`; skipped when the file carries no serial).
 */
export async function findExisting(
  fileHash: string,
  startedAt: Date,
  deviceSerial: string | null
): Promise<Ride | null> {
  const sameActivity =
    deviceSerial != null
      ? and(eq(ride.startedAt, startedAt), eq(ride.deviceSerial, deviceSerial))
      : undefined;
  const match = sameActivity ? or(eq(ride.fileHash, fileHash), sameActivity) : eq(ride.fileHash, fileHash);
  const rows = await db
    .select()
    .from(ride)
    .where(and(live(), match))
    .limit(1);
  return rows[0] ?? null;
}

/** Insert the ride + its stream as one transaction (`db.batch`). Returns the persisted row. */
export async function createRideFromFit(parsed: FitRide, blobKey: string): Promise<Ride> {
  const id = randomUUID();
  const { stream, ...facts } = parsed;
  await db.batch([
    db.insert(ride).values({ id, ...facts, blobKey }),
    db.insert(rideStream).values({
      rideId: id,
      resolutionSeconds: stream.resolutionSeconds,
      data: stream.data,
    }),
  ]);
  const rows = await db.select().from(ride).where(eq(ride.id, id)).limit(1);
  return rows[0];
}

/**
 * Reprocess: rewrite every fact column + rebuild the stream in place (same row id), from a
 * fresh decode of the SAME raw file. The human layer (name/note) and identity (fileHash,
 * blobKey) are untouched — exactly as a Hevy re-pull never touches the annotation.
 */
export async function reprocessRide(id: string, parsed: FitRide): Promise<Ride | null> {
  const existing = await getRideRow(id);
  if (!existing) return null;
  const { stream, fileHash: _fileHash, ...facts } = parsed;
  await db.batch([
    db.update(ride).set(facts).where(eq(ride.id, id)),
    db.delete(rideStream).where(eq(rideStream.rideId, id)),
    db.insert(rideStream).values({
      rideId: id,
      resolutionSeconds: stream.resolutionSeconds,
      data: stream.data,
    }),
  ]);
  return getRideRow(id);
}

// --- Reads ---

export type ListRidesOptions = {
  limit: number;
  offset: number;
  sport?: string;
  from?: string;
  to?: string;
  q?: string;
};

/** The log read: summaries (never streams), newest `startedAt` first. `from`/`to` bound the
 *  LOCAL calendar date; `q` matches the name or the device profile name (unnamed rides are the
 *  norm, and "MTB" should find them). */
export async function listRides(opts: ListRidesOptions): Promise<{ items: RideView[]; count: number }> {
  const conds: (SQL | undefined)[] = [live()];
  if (opts.sport) conds.push(eq(ride.sport, opts.sport));
  if (opts.from) conds.push(gte(ride.localDate, opts.from));
  if (opts.to) conds.push(lte(ride.localDate, opts.to));
  if (opts.q) {
    const pattern = `%${opts.q}%`;
    conds.push(or(ilike(ride.name, pattern), ilike(ride.sportProfileName, pattern)));
  }
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    db.select().from(ride).where(where).orderBy(desc(ride.startedAt)).limit(opts.limit).offset(opts.offset),
    db.select({ n: count() }).from(ride).where(where),
  ]);
  return { items: rows.map(rideToView), count: total[0].n };
}

async function getRideRow(id: string): Promise<Ride | null> {
  const rows = await db
    .select()
    .from(ride)
    .where(and(live(), eq(ride.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** The detail read. The stream rides along only when asked for (it's the heavy part). */
export async function getRide(id: string, { includeStream = false } = {}): Promise<RideDetail | null> {
  const row = await getRideRow(id);
  if (!row) return null;
  let stream: RideStreamView | null = null;
  if (includeStream) {
    const streams = await db.select().from(rideStream).where(eq(rideStream.rideId, id)).limit(1);
    if (streams[0]) {
      stream = {
        resolutionSeconds: streams[0].resolutionSeconds,
        data: streams[0].data as RideStreamView["data"],
      };
    }
  }
  return { ...rideToView(row), stream };
}

/**
 * The weekly rollup, newest week first, at most `weeks` buckets. Weeks with no matching rides
 * are omitted (the strip renders what happened, not a calendar). `avgPowerWatts` is the mean
 * across rides that have it — null when none do.
 */
export async function weeklyStats({ weeks, sport }: { weeks: number; sport?: string }): Promise<WeeklyStats> {
  const weekStart = sql<string>`(date_trunc('week', ${ride.localDate}::date))::date`;
  const conds: (SQL | undefined)[] = [live()];
  if (sport) conds.push(eq(ride.sport, sport));
  const rows = await db
    .select({
      weekStart,
      rides: count(),
      distanceMeters: sql<number>`coalesce(sum(${ride.distanceMeters}), 0)::float8`,
      movingSeconds: sql<number>`coalesce(sum(${ride.movingSeconds}), 0)::float8`,
      totalAscentMeters: sql<number>`coalesce(sum(${ride.totalAscentMeters}), 0)::float8`,
      avgPowerWatts: sql<number | null>`avg(${ride.avgPowerWatts})::float8`,
    })
    .from(ride)
    .where(and(...conds))
    .groupBy(weekStart)
    .orderBy(desc(weekStart))
    .limit(weeks);
  return {
    weeks: rows.map((r) => ({
      weekStart: r.weekStart,
      rides: Number(r.rides),
      distanceMeters: Number(r.distanceMeters),
      movingSeconds: Number(r.movingSeconds),
      totalAscentMeters: Number(r.totalAscentMeters),
      avgPowerWatts: r.avgPowerWatts == null ? null : Number(r.avgPowerWatts),
    })),
  };
}

// --- The human layer + lifecycle ---

/** PATCH name/note (the schema already guarantees nothing else arrives). Returns the view. */
export async function patchRide(
  id: string,
  patch: { name?: string | null; note?: string | null }
): Promise<RideView | null> {
  const rows = await db
    .update(ride)
    .set(patch)
    .where(and(live(), eq(ride.id, id)))
    .returning();
  return rows[0] ? rideToView(rows[0]) : null;
}

/** Soft delete (the kernel default). The blob stays — finished ≠ purged. */
export async function softDeleteRide(id: string): Promise<boolean> {
  const rows = await db
    .update(ride)
    .set({ deletedAt: new Date() })
    .where(and(live(), eq(ride.id, id)))
    .returning({ id: ride.id });
  return rows.length > 0;
}

/**
 * Hard delete (primary key only, route-gated). Cascades to the stream; returns the row so the
 * route can also remove the blob. Works on soft-deleted rows too (that's the cleanup path).
 */
export async function hardDeleteRide(id: string): Promise<Ride | null> {
  const rows = await db.delete(ride).where(eq(ride.id, id)).returning();
  return rows[0] ?? null;
}

/** Internal: the storage row incl. blobKey (reprocess/delete orchestration), live rows only. */
export async function getRideStorageRow(id: string): Promise<Ride | null> {
  return getRideRow(id);
}
