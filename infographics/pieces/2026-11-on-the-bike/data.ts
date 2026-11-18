import { addDays, todayISO } from "../../../src/lib/date";
import { all, unwrap } from "../../src/data/client";
import type { PieceData } from "../../src/data/piece";
import { type RideDecision, settleQuestionableRides } from "../../src/data/sanity";

export type RideType = "MTB" | "Gravel/Road" | "BMX";

/** Ride type comes from the bike (brief: Derived figures). The garage has no type field. */
const TYPE_OF_BIKE: Record<string, RideType> = {
  "Neuron 6": "MTB",
  "Roscoe 8": "MTB",
  "Checkpoint ALR4": "Gravel/Road",
  "Model C": "BMX",
};

/**
 * Curtis's answers about rides the sanity rule flags (top speed over 30 mph). Asked 2026-11-16:
 * on both he drove away from the park with the watch still recording, and both are left out.
 */
const DECISIONS: Record<string, RideDecision> = {
  "d39ce08a-dba3-473f-8186-38e855d75425": { action: "exclude", why: "the watch kept recording in the car" }, // 26 Sep, Roscoe 8, 51.3 mph
  "49f96708-2414-436b-9897-2cd854fea5de": { action: "exclude", why: "the watch kept recording in the car" }, // 7 Nov, Model C, 45.4 mph
};

/** Sums of the rides' own facts. Zone seconds are [below zone 1, zone 1, 2, 3, 4, 5 and above]. */
export type Sums = {
  rides: number;
  movingSeconds: number;
  distanceMeters: number;
  ascentMeters: number;
  zoneSeconds: number[];
  /** Zone 4 and above (brief: "Time at zone 4 or above"). */
  hardSeconds: number;
};

export type Snapshot = {
  /** First ride to the last complete day. Never today. */
  window: { start: string; end: string; days: number };
  totals: Sums & { rideDays: number };
  /** Largest first, by time riding. */
  types: (Sums & { type: RideType; bikes: (Sums & { name: string })[] })[];
  /** Monday-start weeks covering the window; seconds riding by type. */
  weeks: { start: string; rides: number; distanceMeters: number; seconds: Record<RideType, number> }[];
  /** Every ride, oldest first. `hardShare` is the part of the ride at zone 4 or above, 0 to 1. */
  rides: { date: string; type: RideType; bike: string; movingSeconds: number; distanceMeters: number; hardShare: number }[];
  records: {
    longestDistance: { date: string; bike: string; distanceMeters: number };
    longestTime: { date: string; bike: string; movingSeconds: number };
    mostAscent: { date: string; bike: string; ascentMeters: number };
  };
  /** How the watch's zones moved over the window: its max setting, and where zone 4 began. */
  zones: { maxHeartRate: [min: number, max: number]; zone4From: [min: number, max: number] };
  /** Rides left out, and why. The piece says so. */
  excluded: { date: string; bike: string; why: string }[];
};

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const mondayOf = (iso: string) => addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7));
const empty = (): Sums => ({ rides: 0, movingSeconds: 0, distanceMeters: 0, ascentMeters: 0, zoneSeconds: [0, 0, 0, 0, 0, 0], hardSeconds: 0 });

const build: PieceData<Snapshot> = async ({ api, log }) => {
  const today = todayISO();
  const [listed, tags, bikeList] = await Promise.all([
    all((limit, offset) => api.rides.GET("/api/rides", { params: { query: { sport: "cycling", limit, offset } } }).then(unwrap)),
    all((limit, offset) => api.garage.GET("/api/garage/rides", { params: { query: { limit, offset } } }).then(unwrap)),
    api.garage.GET("/api/garage/bikes", { params: { query: { includeRetired: true } } }).then(unwrap),
  ]);
  const complete = listed.filter((r) => r.localDate < today).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const { rides: kept, excluded } = settleQuestionableRides(complete, DECISIONS);

  const bikeName = new Map(bikeList.items.map((b) => [b.id, b.name]));
  const bikeOf = new Map(tags.map((t) => [t.activityId, bikeName.get(t.bikeId)]));
  const named = (id: string, date: string): string => {
    const bike = bikeOf.get(id);
    if (!bike) throw new Error(`The ride on ${date} (${id}) is on no bike. Tag it in the garage first.`);
    return bike;
  };

  const rides = kept.map((r) => {
    const bike = named(r.id, r.localDate);
    const type = TYPE_OF_BIKE[bike];
    if (!type) throw new Error(`"${bike}" has no ride type. Ask Curtis, then add it to TYPE_OF_BIKE.`);
    // The histogram's seven buckets: below zone 1, zones 1 to 5, above the max setting.
    const z = r.timeInHrZone?.timeInHrZone;
    const bounds = r.timeInHrZone?.hrZoneHighBoundary;
    if (!z || z.length !== 7 || !bounds || bounds.length !== 6) throw new Error(`The ride on ${r.localDate} has no usable heart-rate zone histogram.`);
    const zoneSeconds = [z[0], z[1], z[2], z[3], z[4], z[5] + z[6]];
    const hardSeconds = z[4] + z[5] + z[6];
    return {
      date: r.localDate,
      bike,
      type,
      movingSeconds: r.movingSeconds,
      distanceMeters: r.distanceMeters ?? 0,
      ascentMeters: r.totalAscentMeters ?? 0,
      zoneSeconds,
      hardSeconds,
      hardShare: hardSeconds / (zoneSeconds.reduce((a, b) => a + b, 0) || 1),
      maxSetting: bounds[5],
      zone4From: bounds[3],
    };
  });
  if (rides.length === 0) throw new Error("No rides to draw.");

  const add = (into: Sums, r: (typeof rides)[number]) => {
    into.rides += 1;
    into.movingSeconds += r.movingSeconds;
    into.distanceMeters += r.distanceMeters;
    into.ascentMeters += r.ascentMeters;
    r.zoneSeconds.forEach((s, i) => (into.zoneSeconds[i] += s));
    into.hardSeconds += r.hardSeconds;
  };

  const totals = empty();
  const byType = new Map<RideType, Sums & { type: RideType; bikes: (Sums & { name: string })[] }>();
  for (const r of rides) {
    add(totals, r);
    let type = byType.get(r.type);
    if (!type) byType.set(r.type, (type = { ...empty(), type: r.type, bikes: [] }));
    add(type, r);
    let bike = type.bikes.find((b) => b.name === r.bike);
    if (!bike) type.bikes.push((bike = { ...empty(), name: r.bike }));
    add(bike, r);
  }
  const types = [...byType.values()].sort((a, b) => b.movingSeconds - a.movingSeconds);
  for (const type of types) type.bikes.sort((a, b) => b.movingSeconds - a.movingSeconds);

  const start = rides[0].date;
  const end = addDays(today, -1);
  const weeks: Snapshot["weeks"] = [];
  for (let monday = mondayOf(start); monday <= end; monday = addDays(monday, 7)) {
    weeks.push({ start: monday, rides: 0, distanceMeters: 0, seconds: { MTB: 0, "Gravel/Road": 0, BMX: 0 } });
  }
  for (const r of rides) {
    const week = weeks.find((w) => w.start === mondayOf(r.date))!;
    week.rides += 1;
    week.distanceMeters += r.distanceMeters;
    week.seconds[r.type] += r.movingSeconds;
  }

  const top = <K extends "distanceMeters" | "movingSeconds" | "ascentMeters">(key: K) => rides.reduce((best, r) => (r[key] > best[key] ? r : best));
  const range = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)];
  log(`${rides.length} rides kept, ${excluded.length} left out, ${listed.length - complete.length} from today ignored`);

  return {
    window: { start, end, days: Math.round((utc(end) - utc(start)) / DAY) + 1 },
    totals: { ...totals, rideDays: new Set(rides.map((r) => r.date)).size },
    types,
    weeks,
    rides: rides.map(({ date, type, bike, movingSeconds, distanceMeters, hardShare }) => ({ date, type, bike, movingSeconds, distanceMeters, hardShare })),
    records: {
      longestDistance: (({ date, bike, distanceMeters }) => ({ date, bike, distanceMeters }))(top("distanceMeters")),
      longestTime: (({ date, bike, movingSeconds }) => ({ date, bike, movingSeconds }))(top("movingSeconds")),
      mostAscent: (({ date, bike, ascentMeters }) => ({ date, bike, ascentMeters }))(top("ascentMeters")),
    },
    zones: { maxHeartRate: range(rides.map((r) => r.maxSetting)), zone4From: range(rides.map((r) => r.zone4From)) },
    excluded: excluded.map(({ ride, why }) => ({ date: ride.localDate, bike: named(ride.id, ride.localDate), why })),
  };
};

export default build;
