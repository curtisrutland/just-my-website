import { createHash } from "node:crypto";
import { Decoder, Stream } from "@garmin/fitsdk";

/**
 * FIT decode + normalize + downsample — the pure core of the ingestion pipeline (no DB, no
 * Blob, no HTTP; unit-testable against a fixture file). Produces the shape `fitRideSchema`
 * validates; `ingest.ts` owns the parse step so no write path skips validation.
 *
 * Grounding facts (verified against a real Instinct 3 activity, 2026-07-29 — see
 * docs/rides-model.md):
 *  - The SDK decodes to profile-named camelCase messages; FIT timestamps arrive as JS Dates,
 *    EXCEPT `activity.localTimestamp` which stays raw FIT-epoch seconds (offset 631065600).
 *  - GPS is in semicircles (× 180/2³¹ → degrees).
 *  - Records carry only `enhancedSpeed`/`enhancedAltitude` (no plain variants).
 *  - Smart recording spaces records irregularly (1–12 s observed) — downsampling buckets by
 *    TIMESTAMP, never by record index; an empty bucket is a null, not a skipped slot.
 */

/** Thrown for undecodable/unsupported input; the route maps it to a 400 validation_error. */
export class FitDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitDecodeError";
  }
}

/** FIT datetime epoch (1989-12-31T00:00:00Z) as seconds to add to reach the Unix epoch. */
const FIT_EPOCH_OFFSET_S = 631065600;
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

/** The downsample bucket width for v1 (docs/rides-model.md). */
export const STREAM_RESOLUTION_SECONDS = 10;

/** Curtis's timezone — same source as src/lib/date.ts (fallback only; the file usually knows). */
const APP_TZ = process.env.JMW_TZ || "America/Chicago";

type FitMessage = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** 'YYYY-MM-DD' of an instant in Curtis's timezone — the fallback when the file has no localTimestamp. */
function localDateInAppTz(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The ride's local calendar date, from the file's own clock when present. */
function resolveLocalDate(activity: FitMessage | undefined, startedAt: Date): string {
  const lt = activity?.localTimestamp;
  // Raw FIT-epoch seconds (the observed SDK behavior); tolerate a pre-converted Date defensively.
  if (typeof lt === "number" && Number.isFinite(lt)) {
    return new Date((lt + FIT_EPOCH_OFFSET_S) * 1000).toISOString().slice(0, 10);
  }
  if (lt instanceof Date) return lt.toISOString().slice(0, 10);
  return localDateInAppTz(startedAt);
}

/** Downsampled channels: how each is folded into a bucket. */
const MEAN_CHANNELS = ["power", "heartRate", "cadence", "speed"] as const;
const LAST_CHANNELS = ["altitude", "lat", "lon", "distance", "grit", "flow"] as const;
type ChannelName = (typeof MEAN_CHANNELS)[number] | (typeof LAST_CHANNELS)[number];

/** Pull one channel's value out of a record message (unit conversions live here). */
function channelValue(record: FitMessage, channel: ChannelName): number | null {
  switch (channel) {
    case "power":
      return num(record.power);
    case "heartRate":
      return num(record.heartRate);
    case "cadence":
      return num(record.cadence);
    case "speed":
      return num(record.enhancedSpeed) ?? num(record.speed);
    case "altitude":
      return num(record.enhancedAltitude) ?? num(record.altitude);
    case "lat": {
      const v = num(record.positionLat);
      return v == null ? null : v * SEMICIRCLES_TO_DEGREES;
    }
    case "lon": {
      const v = num(record.positionLong);
      return v == null ? null : v * SEMICIRCLES_TO_DEGREES;
    }
    case "distance":
      return num(record.distance);
    case "grit":
      return num(record.grit);
    case "flow":
      return num(record.flow);
  }
}

/**
 * Bucket the raw records into aligned arrays at `resolution` seconds. Buckets with no records
 * yield nulls (gaps stay gaps); channels with no data at all are omitted entirely.
 */
export function downsampleRecords(
  records: FitMessage[],
  startedAt: Date,
  resolution: number = STREAM_RESOLUTION_SECONDS
): { resolutionSeconds: number; data: Record<string, (number | null)[]> } {
  const t0 = startedAt.getTime();
  const stamped = records
    .map((r) => ({ r, offsetS: r.timestamp instanceof Date ? (r.timestamp.getTime() - t0) / 1000 : null }))
    .filter((x): x is { r: FitMessage; offsetS: number } => x.offsetS != null && x.offsetS >= 0);
  if (stamped.length === 0) return { resolutionSeconds: resolution, data: { t: [] } };

  const bucketCount = Math.floor(stamped[stamped.length - 1].offsetS / resolution) + 1;
  const t = Array.from({ length: bucketCount }, (_, i) => i * resolution);
  const channels: Partial<Record<ChannelName, (number | null)[]>> = {};
  const sums: Partial<Record<ChannelName, { sum: number; n: number }[]>> = {};

  const ensure = (name: ChannelName) => {
    channels[name] ??= new Array(bucketCount).fill(null);
    if ((MEAN_CHANNELS as readonly string[]).includes(name)) {
      sums[name] ??= Array.from({ length: bucketCount }, () => ({ sum: 0, n: 0 }));
    }
    return channels[name]!;
  };

  for (const { r, offsetS } of stamped) {
    const bucket = Math.floor(offsetS / resolution);
    for (const name of [...MEAN_CHANNELS, ...LAST_CHANNELS]) {
      const v = channelValue(r, name);
      if (v == null) continue;
      const arr = ensure(name);
      if ((MEAN_CHANNELS as readonly string[]).includes(name)) {
        const cell = sums[name]![bucket];
        cell.sum += v;
        cell.n += 1;
      } else {
        arr[bucket] = v; // bucket-last: later records win
      }
    }
  }
  for (const name of MEAN_CHANNELS) {
    const s = sums[name];
    if (!s) continue;
    channels[name] = s.map((cell) => (cell.n > 0 ? cell.sum / cell.n : null));
  }

  return { resolutionSeconds: resolution, data: { t, ...channels } };
}

/** Make a decoded message JSON-safe for jsonb storage (Dates → ISO strings), verbatim otherwise. */
function jsonSafe(mesg: FitMessage | undefined): Record<string, unknown> | null {
  if (!mesg) return null;
  return JSON.parse(JSON.stringify(mesg, (_k, v) => (v instanceof Date ? v.toISOString() : v)));
}

/**
 * Decode FIT bytes and normalize to the `fitRideSchema` shape. Throws `FitDecodeError` on
 * non-FIT input, integrity failure, no session, or a multi-session (multisport) file —
 * rejected loudly per the model doc, never a silent first-session pick.
 */
export function decodeFitRide(bytes: Buffer) {
  const stream = Stream.fromBuffer(bytes);
  if (!Decoder.isFIT(stream)) throw new FitDecodeError("Not a FIT file");
  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) throw new FitDecodeError("FIT integrity check failed");

  // The SDK types messages per-profile; we access them generically (unknown-first, guarded).
  const { messages } = decoder.read() as unknown as {
    messages: Record<string, FitMessage[] | undefined>;
  };

  const sessions = messages.sessionMesgs ?? [];
  const activity = messages.activityMesgs?.[0];
  const declaredSessions = int(activity?.numSessions) ?? sessions.length;
  if (sessions.length === 0) throw new FitDecodeError("FIT file contains no session");
  if (sessions.length > 1 || declaredSessions > 1) {
    throw new FitDecodeError(
      `Multi-session FIT files are not supported yet (found ${Math.max(sessions.length, declaredSessions)} sessions)`
    );
  }

  const session = sessions[0];
  const fileId = messages.fileIdMesgs?.[0];
  const startedAt = session.startTime;
  if (!(startedAt instanceof Date)) throw new FitDecodeError("Session has no start time");

  const elapsed = num(session.totalElapsedTime);
  const moving = num(session.totalTimerTime) ?? elapsed;
  if (elapsed == null || moving == null) throw new FitDecodeError("Session has no duration");

  // The session-referenced HR-zone histogram (per-lap variants stay in the raw file).
  const timeInHrZone =
    (messages.timeInZoneMesgs ?? []).find((m) => m.referenceMesg === "session") ?? undefined;

  return {
    fileHash: createHash("sha256").update(bytes).digest("hex"),
    sport: str(session.sport) ?? "generic",
    subSport: str(session.subSport),
    sportProfileName: str(session.sportProfileName) ?? str(messages.sportMesgs?.[0]?.name),
    startedAt,
    localDate: resolveLocalDate(activity, startedAt),
    elapsedSeconds: elapsed,
    movingSeconds: moving,
    distanceMeters: num(session.totalDistance),
    totalAscentMeters: num(session.totalAscent),
    totalDescentMeters: num(session.totalDescent),
    avgPowerWatts: num(session.avgPower),
    maxPowerWatts: num(session.maxPower),
    normalizedPowerWatts: num(session.normalizedPower),
    avgHeartRate: int(session.avgHeartRate),
    maxHeartRate: int(session.maxHeartRate),
    avgCadence: num(session.avgCadence),
    maxCadence: num(session.maxCadence),
    avgSpeedMps: num(session.enhancedAvgSpeed) ?? num(session.avgSpeed),
    maxSpeedMps: num(session.enhancedMaxSpeed) ?? num(session.maxSpeed),
    calories: int(session.totalCalories),
    avgTemperatureC: num(session.avgTemperature),
    timeInHrZone: jsonSafe(timeInHrZone),
    deviceManufacturer: str(fileId?.manufacturer),
    // Prefer the readable garminProduct string over the numeric product code.
    deviceProduct: str(fileId?.garminProduct) ?? (num(fileId?.product) != null ? String(fileId!.product) : null),
    deviceSerial: num(fileId?.serialNumber) != null ? String(fileId!.serialNumber) : null,
    rawSession: jsonSafe(session),
    stream: downsampleRecords(messages.recordMesgs ?? [], startedAt),
  };
}
