import { all, unwrap } from "../../src/data/client";
import type { PieceData } from "../../src/data/piece";

/** What the composition reads. Weights are pounds, energy kcal, protein grams, distance metres. */
export type Snapshot = {
  /** First weigh-in to latest weigh-in, both inclusive. */
  window: { start: string; end: string; days: number };
  /** The weight module's rollup: one entry per day, raw weigh-in and its 7-day average. */
  weight: { date: string; weight: number | null; avg: number | null }[];
  /** The weight module's own trend figure for the window, pounds per week. */
  trendPerWeek: number | null;
  /** The macros module's per-day totals and the target that applied. Same days as `weight`. */
  food: { date: string; calories: number; calorieTarget: number | null; protein: number; proteinTarget: number | null }[];
  /** Cycling rides in the window, oldest first, each with the bike the garage has it on. */
  rides: { date: string; bike: string | null; distanceMeters: number | null }[];
  /** Bikes ridden in the window, in order of first ride. */
  bikes: { name: string; rides: number }[];
  totals: {
    days: number;
    weighIns: number;
    daysLogged: number;
    /** Days whose logged calories were at or under that day's target (brief: "Days on target"). */
    caloriesOnTarget: number;
    /** Days whose logged protein was at or over that day's target. */
    proteinOnTarget: number;
    rides: number;
    rideDays: number;
    distanceMeters: number;
    /** The 7-day average on its first full-week day and on the last day (brief: "Pounds down"). */
    poundsDown: { from: { date: string; avg: number }; to: { date: string; avg: number }; change: number };
  };
};

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);
const daysFrom = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

const build: PieceData<Snapshot> = async ({ api, log }) => {
  // The window is the weigh-in log itself: first entry to latest.
  const entries = await all((limit, offset) => api.weight.GET("/api/weight/entries", { params: { query: { limit, offset } } }).then(unwrap));
  const dates = entries.map((e) => e.measuredOn).sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  const days = daysFrom(start, end) + 1;
  log(`window ${start} to ${end}: ${days} days, ${entries.length} weigh-ins`);

  const rollup = unwrap(await api.weight.GET("/api/weight/rollup", { params: { query: { window: days, end } } }));
  const weight = rollup.series;
  if (weight.length !== days || weight[0].date !== start || weight[weight.length - 1].date !== end) {
    throw new Error(`The weight rollup does not cover ${start} to ${end} (got ${weight.length} days from ${weight[0]?.date}).`);
  }

  // The macros range read spans at most 366 days, so a longer window is read in pieces.
  const food: Snapshot["food"] = [];
  for (let from = start; from <= end; from = addDays(from, 366)) {
    const to = addDays(from, 365) < end ? addDays(from, 365) : end;
    const chunk = unwrap(await api.macros.GET("/api/macros/range", { params: { query: { start: from, end: to } } }));
    for (const day of chunk) {
      food.push({
        date: day.date,
        calories: day.totals.calories ?? 0,
        calorieTarget: day.target?.calories ?? null,
        protein: day.totals.proteinContent ?? 0,
        proteinTarget: day.target?.proteinContent ?? null,
      });
    }
  }
  if (food.length !== days) throw new Error(`The food log returned ${food.length} days for a ${days}-day window.`);

  const [allRides, tags, bikeList] = await Promise.all([
    all((limit, offset) => api.rides.GET("/api/rides", { params: { query: { sport: "cycling", from: start, to: end, limit, offset } } }).then(unwrap)),
    all((limit, offset) => api.garage.GET("/api/garage/rides", { params: { query: { from: start, to: end, limit, offset } } }).then(unwrap)),
    api.garage.GET("/api/garage/bikes", { params: { query: { includeRetired: true } } }).then(unwrap),
  ]);
  const bikeName = new Map(bikeList.items.map((b) => [b.id, b.name]));
  const bikeOfRide = new Map(tags.map((t) => [t.activityId, bikeName.get(t.bikeId) ?? null]));
  const rides = allRides
    .map((r) => ({ date: r.localDate, bike: bikeOfRide.get(r.id) ?? null, distanceMeters: r.distanceMeters, startedAt: r.startedAt }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(({ startedAt: _, ...ride }) => ride);
  const bikes: Snapshot["bikes"] = [];
  for (const ride of rides) {
    if (!ride.bike) continue;
    const seen = bikes.find((b) => b.name === ride.bike);
    if (seen) seen.rides += 1;
    else bikes.push({ name: ride.bike, rides: 1 });
  }
  log(`${rides.length} rides on ${new Set(rides.map((r) => r.date)).size} days; ${rides.filter((r) => !r.bike).length} with no bike`);

  // "Pounds down": the 7-day average on the first day it covers a full week, against the last day.
  const first = weight[6];
  const last = weight[weight.length - 1];
  if (first?.avg == null || last.avg == null) throw new Error("The window is too short for a full-week average.");
  const logged = food.filter((d) => d.calories > 0);

  return {
    window: { start, end, days },
    weight,
    trendPerWeek: rollup.summary.trendPerWeek,
    food,
    rides,
    bikes,
    totals: {
      days,
      weighIns: weight.filter((d) => d.weight != null).length,
      daysLogged: logged.length,
      caloriesOnTarget: logged.filter((d) => d.calorieTarget != null && d.calories <= d.calorieTarget).length,
      proteinOnTarget: logged.filter((d) => d.proteinTarget != null && d.protein >= d.proteinTarget).length,
      rides: rides.length,
      rideDays: new Set(rides.map((r) => r.date)).size,
      distanceMeters: rides.reduce((sum, r) => sum + (r.distanceMeters ?? 0), 0),
      poundsDown: {
        from: { date: first.date, avg: first.avg },
        to: { date: last.date, avg: last.avg },
        change: last.avg - first.avg,
      },
    },
  };
};

export default build;
