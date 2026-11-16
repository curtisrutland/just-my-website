import * as z from "zod";
import { calendarDate, isoInstant, paginatedSchema } from "@/lib/http/view-schemas";

/**
 * Garage module — Zod schemas. Single source of truth for validation; both write surfaces (web
 * server actions, token API) and the one-time backfill script call these. See docs/garage-model.md.
 *
 * Three things: bikes, the profile rules that auto-tag rides ("GRAVEL" → the Checkpoint), and ride
 * tags. A tag carries the ride's facts COPIED in at write time (CONVENTIONS §9) — the garage never
 * reads the rides module, so whoever tags a ride hands those facts over.
 */

/** A device activity profile as it appears on a ride (`sportProfileName`). Matched case-insensitively. */
export const profileSchema = z.string().trim().min(1).max(40);

const year = z.number().int().min(1900).max(2100);

export const bikeCreateSchema = z
  .object({
    // The nickname. Optional on create: it defaults to the model name.
    name: z.string().trim().min(1).max(60).optional(),
    brand: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    modelYear: year,
    note: z.string().trim().min(1).nullable().optional(),
    profiles: z.array(profileSchema).max(20).optional(),
  })
  .strict();

// PATCH: any create field. `profiles` REPLACES the bike's set. Setting `retiredOn` retires the bike,
// which also drops its profiles (a retired bike is offered for no new tags); `null` un-retires it.
export const bikePatchSchema = bikeCreateSchema
  .partial()
  .extend({
    name: z.string().trim().min(1).max(60).optional(),
    retiredOn: calendarDate.nullable().optional(),
  })
  .strict();

export type BikeCreate = z.infer<typeof bikeCreateSchema>;
export type BikePatch = z.infer<typeof bikePatchSchema>;

/** The ride facts a tag copies in — the subset of a rides-module `RideView` the garage needs. */
export const rideFactsSchema = z
  .object({
    activityId: z.uuid(),
    localDate: calendarDate,
    startedAt: isoInstant,
    sportProfileName: z.string().nullable(),
    movingSeconds: z.number().min(0),
    distanceMeters: z.number().min(0).nullable(),
  })
  .strict();

export type RideFacts = z.infer<typeof rideFactsSchema>;

export const assignedBySchema = z.enum(["rule", "manual", "backfill"]);
export type AssignedBy = z.infer<typeof assignedBySchema>;

/**
 * Tag a ride by hand (the web picker, the API). `backfill` is for the one-time initial load, which
 * records why in `reason`; rule tags are only ever made by `attribute`.
 */
export const rideTagCreateSchema = rideFactsSchema
  .extend({
    bikeId: z.uuid(),
    assignedBy: z.enum(["manual", "backfill"]).default("manual"),
    reason: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

/** Move a tagged ride to another bike. A person moved it, so it becomes `manual`. */
export const rideTagPatchSchema = z.object({ bikeId: z.uuid() }).strict();

/** Apply the profile rules to a batch of rides (the daemon after upload, the web upload, the sweep). */
export const attributeSchema = z.object({ rides: z.array(rideFactsSchema).min(1).max(500) }).strict();

export type RideTagCreate = z.input<typeof rideTagCreateSchema>;
export type RideTagPatch = z.infer<typeof rideTagPatchSchema>;
export type AttributeInput = z.infer<typeof attributeSchema>;

export const rideTagListQuerySchema = z.object({
  bikeId: z.uuid().optional(),
  activityId: z.uuid().optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
});

// --- Response views (the JSON the routes send; OpenAPI + the contract test read these) ---

/** A bike with its profiles and the totals derived from its live ride tags (never stored). */
export const bikeViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  brand: z.string(),
  model: z.string(),
  modelYear: z.number().int(),
  note: z.string().nullable(),
  retiredOn: calendarDate.nullable(),
  profiles: z.array(z.string()),
  rides: z.number().int(),
  movingSeconds: z.number(),
  distanceMeters: z.number(),
  lastRiddenOn: calendarDate.nullable(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
});

export const bikeListSchema = z.object({ items: z.array(bikeViewSchema) });

export const rideTagViewSchema = z.object({
  id: z.uuid(),
  activityId: z.uuid(),
  bikeId: z.uuid(),
  assignedBy: assignedBySchema,
  reason: z.string().nullable(),
  localDate: calendarDate,
  startedAt: isoInstant,
  sportProfileName: z.string().nullable(),
  movingSeconds: z.number(),
  distanceMeters: z.number().nullable(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
});

export const rideTagListSchema = paginatedSchema(rideTagViewSchema);

/** What `attribute` did: tags it created or re-pointed, rides it left alone, rides no rule matched. */
export const attributeResultSchema = z.object({
  tagged: z.array(rideTagViewSchema),
  unchanged: z.array(z.uuid()),
  unmatched: z.array(z.uuid()),
});
