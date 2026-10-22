import * as z from "zod";
import { calendarDate, isoInstant, paginatedSchema } from "@/lib/http/view-schemas";

/**
 * Rides module — Zod schemas. The SINGLE SOURCE OF TRUTH for validation (CONVENTIONS §1, §5).
 * Two families, mirroring lifting (the other ingestion module):
 *
 *  1. INGESTION — `fitRideSchema` validates the NORMALIZED output of the FIT decode
 *     (`fit.ts`). The kernel rule "no write path skips validation" survives the binary input:
 *     the pipeline is decode(bytes) → normalize → fitRideSchema.parse → repo. There is
 *     deliberately NO `rideCreateSchema` — rides are never authored, only ingested.
 *  2. THE HUMAN LAYER — `ridePatchSchema`, the ONLY surface write. `name` + `note`, nothing
 *     else: every measured column is immutable from the surfaces (corrections happen by
 *     reprocessing the file, not by editing watts). `.strict()` is what enforces that — a
 *     well-meaning `{ avgPowerWatts: 250 }` is a 400, not a correction.
 *
 * Units are SI throughout (m, s, m/s, W, bpm, kcal, °C) — FIT's native units, matching
 * CONVENTIONS §6. Display units (mi/ft/mph) are a UI concern. See docs/rides-model.md.
 */

// --- Ingestion ---

/**
 * The downsampled stream: aligned arrays keyed by channel. `t` (seconds from start) is required
 * and every other channel must align to it — null = a gap (Garmin smart recording is irregular,
 * so gaps are normal data, not errors). Absent key = channel never recorded.
 */
export const streamDataSchema = z
  .record(z.string(), z.array(z.number().nullable()))
  .refine((d) => Array.isArray(d.t) && d.t.every((v) => typeof v === "number"), {
    message: "stream data requires a numeric `t` channel",
  })
  // Guarded: when `t` is absent the first refine already fails; don't crash on d.t here.
  .refine((d) => !Array.isArray(d.t) || Object.values(d).every((arr) => arr.length === d.t.length), {
    message: "every stream channel must align to `t` (same length)",
  });

export const rideStreamSchema = z.object({
  resolutionSeconds: z.number().int().positive(),
  data: streamDataSchema,
});

/**
 * The normalized decode of one single-session FIT activity. Nearly everything is nullable —
 * honesty about what a given device captured (a watch ride has no power; a trainer ride no GPS).
 * Extra decoded keys land in `rawSession`, not here; the raw file itself lives in Blob.
 */
export const fitRideSchema = z.object({
  // sha256 hex of the FIT bytes — the primary dedupe key.
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  sport: z.string().min(1),
  subSport: z.string().nullable(),
  // The device profile name ("MTB") — the display fallback of choice.
  sportProfileName: z.string().nullable(),
  startedAt: z.date(),
  // The ride's LOCAL calendar date, from the file's own activity.localTimestamp.
  localDate: z.iso.date(),
  elapsedSeconds: z.number().nonnegative(),
  movingSeconds: z.number().nonnegative(),
  distanceMeters: z.number().nonnegative().nullable(),
  totalAscentMeters: z.number().nullable(),
  totalDescentMeters: z.number().nullable(),
  avgPowerWatts: z.number().nullable(),
  maxPowerWatts: z.number().nullable(),
  normalizedPowerWatts: z.number().nullable(),
  avgHeartRate: z.number().int().nullable(),
  maxHeartRate: z.number().int().nullable(),
  avgCadence: z.number().nullable(),
  maxCadence: z.number().nullable(),
  avgSpeedMps: z.number().nullable(),
  maxSpeedMps: z.number().nullable(),
  calories: z.number().int().nullable(),
  avgTemperatureC: z.number().nullable(),
  // The session-referenced timeInZone message verbatim (seconds-per-zone + the boundaries it
  // was computed with). A histogram of measurements, not a model score.
  timeInHrZone: z.record(z.string(), z.unknown()).nullable(),
  deviceManufacturer: z.string().nullable(),
  deviceProduct: z.string().nullable(),
  deviceSerial: z.string().nullable(),
  // The decoded session message verbatim — where unmodeled numbers survive.
  rawSession: z.record(z.string(), z.unknown()).nullable(),
  stream: rideStreamSchema,
});

export type FitRide = z.infer<typeof fitRideSchema>;

// --- The human layer: the ONLY surface write ---

/** PATCH body: `name` + `note`, both clearable via null. `.strict()` keeps the facts immutable. */
export const ridePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullable(),
    note: z.string().trim().max(4000).nullable(),
  })
  .partial()
  .strict();

export type RidePatch = z.infer<typeof ridePatchSchema>;

// --- Query vocab (route-side filters) ---

/** `status`-style closed vocab for the list read: a sport string is free-form, verbatim Garmin. */
export const rideListQuerySchema = z.object({
  sport: z.string().min(1).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().min(1).optional(),
});

// --- Response views (the JSON the routes send; OpenAPI + the contract test read these) ---
// Instants are ISO strings; `localDate` is a 'YYYY-MM-DD' calendar date; every quantity is SI
// (m, s, m/s, W, bpm, kcal, °C) — display units (mi/ft/mph) are a UI concern.

/**
 * The session-referenced HR-zone histogram, verbatim from the file: seconds-per-zone plus the
 * boundaries it was computed with — self-describing, so a later zone-config change never
 * falsifies old rides. A histogram of measurements, not a model score. Loose: it carries whatever
 * else the file put in the zone message.
 */
export const timeInHrZoneSchema = z.looseObject({
  timeInHrZone: z.array(z.number()).optional(),
  hrZoneHighBoundary: z.array(z.number()).optional(),
  maxHeartRate: z.number().optional(),
});

/** One ride as read — the one view schema every read surface shares (field-parity rule). */
export const rideViewSchema = z.object({
  id: z.uuid(),
  /** The human layer (the only surface-writable fields). */
  name: z.string().nullable(),
  note: z.string().nullable(),
  sport: z.string(),
  subSport: z.string().nullable(),
  /** Device profile name ("MTB") — the display fallback for unnamed rides. */
  sportProfileName: z.string().nullable(),
  /** ISO 8601 instant (UTC). */
  startedAt: isoInstant,
  /** The ride's LOCAL calendar date, from the file's own clock. */
  localDate: calendarDate,
  elapsedSeconds: z.number(),
  movingSeconds: z.number(),
  distanceMeters: z.number().nullable(),
  totalAscentMeters: z.number().nullable(),
  totalDescentMeters: z.number().nullable(),
  avgPowerWatts: z.number().nullable(),
  maxPowerWatts: z.number().nullable(),
  normalizedPowerWatts: z.number().nullable(),
  avgHeartRate: z.number().nullable(),
  maxHeartRate: z.number().nullable(),
  avgCadence: z.number().nullable(),
  maxCadence: z.number().nullable(),
  avgSpeedMps: z.number().nullable(),
  maxSpeedMps: z.number().nullable(),
  calories: z.number().nullable(),
  avgTemperatureC: z.number().nullable(),
  timeInHrZone: timeInHrZoneSchema.nullable(),
  deviceManufacturer: z.string().nullable(),
  deviceProduct: z.string().nullable(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
});

/** The downsampled time series as read: `t` (seconds from start) plus aligned channels; absent key = never recorded. */
export const rideStreamViewSchema = z.object({
  resolutionSeconds: z.number().int(),
  data: z.object({ t: z.array(z.number()) }).catchall(z.array(z.number().nullable())),
});

/** Full ride — the detail read. `stream` is included only when the read asks for it (`?streams=1`). */
export const rideDetailSchema = rideViewSchema.extend({ stream: rideStreamViewSchema.nullable() });

/** `GET /api/rides`: a page of rides. */
export const rideListSchema = paginatedSchema(rideViewSchema);

/** One ISO week of the rollup (weeks with no matching rides are omitted). */
export const weeklyBucketSchema = z.object({
  /** Monday of the ISO week, 'YYYY-MM-DD'. */
  weekStart: calendarDate,
  rides: z.number().int(),
  distanceMeters: z.number(),
  movingSeconds: z.number(),
  totalAscentMeters: z.number(),
  /** Mean of avg_power_watts across the week's rides that have it; null when none do. */
  avgPowerWatts: z.number().nullable(),
});

export const weeklyStatsSchema = z.object({ weeks: z.array(weeklyBucketSchema) });
