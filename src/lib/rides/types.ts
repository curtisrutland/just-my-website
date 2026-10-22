import type * as z from "zod";
import type {
  rideDetailSchema,
  rideStreamViewSchema,
  rideViewSchema,
  timeInHrZoneSchema,
  weeklyBucketSchema,
  weeklyStatsSchema,
} from "./schema";

/**
 * Rides module — domain + response-contract types. Shared by `repo.ts` (which builds them) and
 * the UI (which renders them); per the layering rule these live in `lib`, never in components.
 * Instants are ISO strings; `localDate` is a 'YYYY-MM-DD' calendar date; every quantity is SI
 * (m, s, m/s, W, bpm, kcal, °C) — display units (mi/ft/mph) are a UI concern. The views are
 * inferred from `schema.ts` (where each field is documented), so the repo's builders are
 * type-checked against the published contract.
 */

export type TimeInHrZone = z.infer<typeof timeInHrZoneSchema>;
/** One ride as read — the one view every read surface shares (field-parity rule). */
export type RideView = z.infer<typeof rideViewSchema>;
export type RideStreamView = z.infer<typeof rideStreamViewSchema>;
/** Full ride — the detail read. `stream` is included only when the read asks for it. */
export type RideDetail = z.infer<typeof rideDetailSchema>;

/** The upload response: the ride plus whether it was a dedupe hit (idempotent re-upload). */
export type IngestResult = {
  ride: RideView;
  /** True when the file (or the same activity from the same device) was already ingested. */
  deduped: boolean;
};

export type WeeklyBucket = z.infer<typeof weeklyBucketSchema>;
export type WeeklyStats = z.infer<typeof weeklyStatsSchema>;
