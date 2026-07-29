/**
 * Rides module — domain + response-contract types. Shared by `repo.ts` (which builds them) and
 * the UI (which renders them); per the layering rule these live in `lib`, never in components.
 * Instants are ISO strings; `localDate` is a 'YYYY-MM-DD' calendar date; every quantity is SI
 * (m, s, m/s, W, bpm, kcal, °C) — display units (mi/ft/mph) are a UI concern.
 */

/**
 * The session-referenced HR-zone histogram, verbatim from the file: seconds-per-zone plus the
 * boundaries it was computed with — self-describing, so a later zone-config change never
 * falsifies old rides. A histogram of measurements, not a model score.
 */
export type TimeInHrZone = {
  timeInHrZone?: number[];
  hrZoneHighBoundary?: number[];
  maxHeartRate?: number;
  [key: string]: unknown;
};

/** One ride as read — the one view schema every read surface shares (field-parity rule). */
export type RideView = {
  id: string;
  /** The human layer (the only surface-writable fields). */
  name: string | null;
  note: string | null;
  sport: string;
  subSport: string | null;
  /** Device profile name ("MTB") — the display fallback for unnamed rides. */
  sportProfileName: string | null;
  /** ISO 8601 instant (UTC). */
  startedAt: string;
  /** The ride's LOCAL calendar date, from the file's own clock. */
  localDate: string;
  elapsedSeconds: number;
  movingSeconds: number;
  distanceMeters: number | null;
  totalAscentMeters: number | null;
  totalDescentMeters: number | null;
  avgPowerWatts: number | null;
  maxPowerWatts: number | null;
  normalizedPowerWatts: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  calories: number | null;
  avgTemperatureC: number | null;
  timeInHrZone: TimeInHrZone | null;
  deviceManufacturer: string | null;
  deviceProduct: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The downsampled time series (aligned arrays; absent key = channel never recorded). */
export type RideStreamView = {
  resolutionSeconds: number;
  data: {
    /** Seconds from start. */
    t: number[];
    [channel: string]: (number | null)[];
  };
};

/** Full ride — the detail read. `stream` is included only when the read asks for it. */
export type RideDetail = RideView & {
  stream: RideStreamView | null;
};

/** The upload response: the ride plus whether it was a dedupe hit (idempotent re-upload). */
export type IngestResult = {
  ride: RideView;
  /** True when the file (or the same activity from the same device) was already ingested. */
  deduped: boolean;
};

/** One ISO week of the rollup (weeks with no matching rides are omitted). */
export type WeeklyBucket = {
  /** Monday of the ISO week, 'YYYY-MM-DD'. */
  weekStart: string;
  rides: number;
  distanceMeters: number;
  movingSeconds: number;
  totalAscentMeters: number;
  /** Mean of avg_power_watts across the week's rides that have it; null when none do. */
  avgPowerWatts: number | null;
};

export type WeeklyStats = { weeks: WeeklyBucket[] };
