import type { RideDetail, RideView } from "@/lib/rides/types";

/**
 * Rides UI mock data for the dev `/preview` harness (read-only, no server actions). The first
 * ride is the REAL first-ingested activity's numbers (2026-07-28 MTB, Instinct 3 — watch ride:
 * no power/cadence, HR + GPS only); the others cover the with-power card and the no-GPS trainer
 * state the design brief calls out. The stream is synthetic but honest: 10 s buckets, irregular
 * smart-recording gap included, so the gap-stays-open chart path renders in preview.
 */

const ZB = [90, 107, 125, 143, 161, 179];

const base = {
  note: null as string | null,
  avgPowerWatts: null as number | null,
  maxPowerWatts: null as number | null,
  normalizedPowerWatts: null as number | null,
  avgCadence: null as number | null,
  maxCadence: null as number | null,
  avgTemperatureC: null as number | null,
  deviceManufacturer: "garmin",
  deviceProduct: "instinct3Amoled50mm",
  createdAt: "2026-07-29T16:00:00Z",
  updatedAt: "2026-07-29T16:00:00Z",
};

export const mockRides: RideView[] = [
  {
    ...base,
    id: "m1",
    name: null,
    sport: "cycling",
    subSport: "mountain",
    sportProfileName: "MTB",
    startedAt: "2026-07-29T00:46:39Z",
    localDate: "2026-07-28",
    elapsedSeconds: 2621.5,
    movingSeconds: 2621.5,
    distanceMeters: 6053.1,
    totalAscentMeters: 88,
    totalDescentMeters: 90,
    avgHeartRate: 138,
    maxHeartRate: 177,
    avgSpeedMps: 2.309,
    maxSpeedMps: 8.118,
    calories: 616,
    timeInHrZone: { timeInHrZone: [3.0, 436.2, 362.0, 555.0, 810.3, 455.0, 0], hrZoneHighBoundary: ZB, maxHeartRate: 179 },
  },
  {
    ...base,
    id: "m2",
    name: "Big climb loop",
    note: "First time up the back side. Legs OK, ran out of water.",
    sport: "cycling",
    subSport: "road",
    sportProfileName: "Road",
    startedAt: "2026-07-26T11:12:04Z",
    localDate: "2026-07-26",
    elapsedSeconds: 11040,
    movingSeconds: 10561,
    distanceMeters: 64820,
    totalAscentMeters: 811,
    totalDescentMeters: 805,
    avgPowerWatts: 187,
    maxPowerWatts: 642,
    normalizedPowerWatts: 203,
    avgHeartRate: 142,
    maxHeartRate: 168,
    avgSpeedMps: 6.14,
    maxSpeedMps: 13.2,
    calories: 1804,
    timeInHrZone: { timeInHrZone: [0, 900, 1600, 2400, 3900, 1761, 0], hrZoneHighBoundary: ZB, maxHeartRate: 179 },
  },
  {
    ...base,
    id: "m3",
    name: null,
    sport: "cycling",
    subSport: "indoor_cycling",
    sportProfileName: "Indoor",
    startedAt: "2026-07-24T23:30:00Z",
    localDate: "2026-07-24",
    elapsedSeconds: 3600,
    movingSeconds: 3600,
    distanceMeters: null,
    totalAscentMeters: null,
    totalDescentMeters: null,
    avgPowerWatts: 205,
    maxPowerWatts: 340,
    normalizedPowerWatts: 214,
    avgHeartRate: 149,
    maxHeartRate: 171,
    avgSpeedMps: null,
    maxSpeedMps: null,
    calories: 730,
    timeInHrZone: { timeInHrZone: [0, 120, 420, 900, 1740, 420, 0], hrZoneHighBoundary: ZB, maxHeartRate: 179 },
  },
  {
    ...base,
    id: "m4",
    name: "Ridge trail",
    note: "Ridge trail with M. Slow on purpose.",
    sport: "hiking",
    subSport: null,
    sportProfileName: "Hike",
    startedAt: "2026-07-19T14:20:00Z",
    localDate: "2026-07-19",
    elapsedSeconds: 6240,
    movingSeconds: 5820,
    distanceMeters: 7240,
    totalAscentMeters: 305,
    totalDescentMeters: 301,
    avgHeartRate: 118,
    maxHeartRate: 142,
    avgSpeedMps: 1.244,
    maxSpeedMps: 2.1,
    calories: 612,
    timeInHrZone: null,
  },
];

/** Synthetic-but-honest stream for the MTB detail preview: 263 × 10 s buckets, one 40 s gap. */
function mtbStream() {
  const N = 263;
  const T = 10;
  const t: number[] = [];
  const lat: (number | null)[] = [];
  const lon: (number | null)[] = [];
  const altitude: (number | null)[] = [];
  const speed: (number | null)[] = [];
  const heartRate: (number | null)[] = [];
  const distance: (number | null)[] = [];
  let d = 0;
  for (let i = 0; i < N; i++) {
    const p = i / (N - 1);
    const ang = p * Math.PI * 2;
    t.push(i * T);
    const gap = i * T >= 1190 && i * T <= 1230;
    if (gap) {
      lat.push(null);
      lon.push(null);
      altitude.push(null);
      speed.push(null);
      heartRate.push(null);
      distance.push(d);
      continue;
    }
    const r = 900 + 190 * Math.sin(ang * 3) + 90 * Math.cos(ang * 5);
    lat.push(30.399 + (r * Math.sin(ang) * 0.78) / 111320);
    lon.push(-97.77 + (r * Math.cos(ang)) / 95000);
    altitude.push(197 + 12 * Math.sin(p * 6.283) + 8 * Math.sin(p * 12.566 + 0.6));
    const v = Math.max(0.3, 2.3 + 1.9 * Math.sin(p * 12.566) + 1.1 * Math.sin(p * 35.8 + 1.2));
    speed.push(v);
    d += v * T;
    distance.push(Math.round(d * 10) / 10);
    heartRate.push(Math.round(132 + 26 * Math.sin(p * 10.05 - 0.7) + 9 * Math.sin(p * 27) + p * 10));
  }
  return { resolutionSeconds: T, data: { t, lat, lon, altitude, speed, heartRate, distance } };
}

export const mockDetail: RideDetail = { ...mockRides[0], stream: mtbStream() };
