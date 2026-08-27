import type { VitalsDayView, VitalsPoint, VitalsRollup, VitalsTrend } from "@/lib/vitals/types";

/**
 * Vitals UI mock data for the dev `/preview` harness (read-only — the module has no write path
 * anywhere, so there is nothing to stub out).
 *
 * The first day is the REAL 2026-08-24 payload captured from Curtis's account. The rest are
 * synthetic but deliberately UNTIDY, because the honest states are the ones worth seeing in
 * preview: a day the watch was worn but never slept in (no sleep block), a day with a row and no
 * measurements at all, and two days with no row at all. If the table ever renders a `0` where one
 * of these should show an em-dash, the preview is where it will be obvious.
 */

const AUDIT = { id: "mock", createdAt: "2026-08-25T12:00:00.000Z", updatedAt: "2026-08-25T12:00:00.000Z" };

const EMPTY = {
  sleepTotalSeconds: null, sleepDeepSeconds: null, sleepLightSeconds: null, sleepRemSeconds: null,
  sleepAwakeSeconds: null, napSeconds: null, sleepStartAt: null, sleepEndAt: null,
  sleepSpo2Avg: null, sleepSpo2Low: null, sleepRespirationAvg: null,
  hrvLastNightMs: null, hrvLastNight5MinHighMs: null,
  restingHeartRate: null, minHeartRate: null, maxHeartRate: null,
  spo2Avg: null, spo2Low: null, respirationWakingAvg: null, respirationLow: null, respirationHigh: null,
  steps: null, floorsAscended: null, intensityMinutesModerate: null, intensityMinutesVigorous: null,
} satisfies Omit<VitalsDayView, "id" | "createdAt" | "updatedAt" | "measuredOn">;

export const mockDays: VitalsDayView[] = [
  {
    ...AUDIT, ...EMPTY,
    measuredOn: "2026-08-28",
    // Worn all day, but no sleep was recorded — the watch came off overnight.
    restingHeartRate: 47, minHeartRate: 45, maxHeartRate: 132,
    spo2Avg: 95, spo2Low: 89, respirationWakingAvg: 15.5, respirationLow: 9, respirationHigh: 24,
    steps: 8214, floorsAscended: 12.4, intensityMinutesModerate: 18, intensityMinutesVigorous: 6,
  },
  // A row exists, but nothing was measured — distinct from having no row at all.
  { ...AUDIT, ...EMPTY, measuredOn: "2026-08-27" },
  {
    ...AUDIT, ...EMPTY,
    measuredOn: "2026-08-26",
    sleepTotalSeconds: 25080, sleepDeepSeconds: 4020, sleepLightSeconds: 16680,
    sleepRemSeconds: 4380, sleepAwakeSeconds: 1980, napSeconds: 0,
    sleepStartAt: "2026-08-26T03:41:00.000Z", sleepEndAt: "2026-08-26T11:00:00.000Z",
    sleepSpo2Avg: 96, sleepSpo2Low: 88, sleepRespirationAvg: 12.5,
    hrvLastNightMs: 59, hrvLastNight5MinHighMs: 104,
    restingHeartRate: 43, minHeartRate: 42, maxHeartRate: 158,
    spo2Avg: 95, spo2Low: 87, respirationWakingAvg: 15, respirationLow: 8, respirationHigh: 25,
    steps: 2852, floorsAscended: 3.1, intensityMinutesModerate: 0, intensityMinutesVigorous: 41,
  },
  {
    // The real captured day (docs/vitals-model.md; also the normalizer's test fixture).
    ...AUDIT, ...EMPTY,
    measuredOn: "2026-08-24",
    sleepTotalSeconds: 22560, sleepDeepSeconds: 3240, sleepLightSeconds: 15780,
    sleepRemSeconds: 3540, sleepAwakeSeconds: 2520, napSeconds: 0,
    sleepStartAt: "2026-08-24T05:28:09.000Z", sleepEndAt: "2026-08-24T12:26:09.000Z",
    sleepSpo2Avg: 95, sleepSpo2Low: 85, sleepRespirationAvg: 13,
    hrvLastNightMs: 60, hrvLastNight5MinHighMs: 111,
    restingHeartRate: 45, minHeartRate: 44, maxHeartRate: 119,
    spo2Avg: 94, spo2Low: 85, respirationWakingAvg: 16, respirationLow: 7, respirationHigh: 26,
    steps: 4435, floorsAscended: 7.26, intensityMinutesModerate: 0, intensityMinutesVigorous: 1,
  },
];

/** A 14-day series with two holes, so the sparkline's break-on-gap path renders in preview. */
function series(base: number, spread: number, holes: number[]): VitalsPoint[] {
  const out: VitalsPoint[] = [];
  const vals: (number | null)[] = [];
  for (let i = 0; i < 14; i++) {
    vals.push(holes.includes(i) ? null : Math.round(base + Math.sin(i / 2.1) * spread));
  }
  for (let i = 0; i < 14; i++) {
    const day = new Date(Date.UTC(2026, 7, 15 + i)).toISOString().slice(0, 10);
    const win = vals.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v != null);
    out.push({
      date: day,
      value: vals[i],
      avg: win.length ? Math.round((win.reduce((a, b) => a + b, 0) / win.length) * 10) / 10 : null,
    });
  }
  return out;
}

const trend = (s: VitalsPoint[], delta: number | null): VitalsTrend => ({
  current: s[s.length - 1].value,
  currentAvg: s[s.length - 1].avg,
  deltaPerWeek: delta,
  series: s,
});

export const mockRollup: VitalsRollup = {
  window: 14,
  from: "2026-08-15",
  to: "2026-08-28",
  restingHeartRate: trend(series(45, 2.5, [4, 9]), -0.8),
  hrvLastNightMs: trend(series(55, 7, [4, 9]), 2.1),
  sleepTotalSeconds: trend(series(23000, 3200, [4, 9]), 900),
  gaps: [
    { date: "2026-08-19", reason: "no_row" },
    { date: "2026-08-24", reason: "no_row" },
    { date: "2026-08-27", reason: "no_measurements" },
  ],
};
