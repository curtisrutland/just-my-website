import type { RideStreamView } from "@/lib/rides/types";

/**
 * Ride playback — the pure math (unit-tested; no React, no Leaflet). The stream is already a
 * timeline (`t` seconds-from-start with aligned channels), so playback is a playhead value
 * swept over it. Two honesty rules live here:
 *
 *  1. The marker GLIDES between adjacent recorded points (linear interpolation) — 10 s GPS
 *     buckets would otherwise teleport ~50 m per tick.
 *  2. A recording gap is NEVER bridged: when the neighbors span more than 2 buckets, the
 *     position HOLDS at the last recorded point and is flagged `stale` (the marker dims).
 *     Sweeping a straight line through unrecorded territory would be invented data.
 */

/** Nearest stream index for a playhead time (for the chart crosshair/readouts). */
export function nearestIndex(t: number[], tSec: number): number {
  if (t.length === 0) return 0;
  const duration = t[t.length - 1] || 1;
  const clamped = Math.min(Math.max(tSec, 0), duration);
  // Buckets are uniform in practice; derive from spacing but clamp for safety.
  const spacing = t.length > 1 ? duration / (t.length - 1) : 1;
  return Math.min(t.length - 1, Math.max(0, Math.round(clamped / spacing)));
}

export type PlayheadPosition = { lat: number; lon: number; stale: boolean };

/**
 * The GPS position at a playhead time, interpolated between the bracketing RECORDED points.
 * Returns null when the stream has no GPS, or nothing has been recorded yet by `tSec`.
 */
export function positionAt(data: RideStreamView["data"], tSec: number, resolutionSeconds: number): PlayheadPosition | null {
  const { t, lat, lon } = data;
  if (!lat || !lon || t.length === 0) return null;
  const duration = t[t.length - 1];
  const at = Math.min(Math.max(tSec, 0), duration);

  // Last recorded point at-or-before, first recorded point after.
  let prev = -1;
  let next = -1;
  for (let i = 0; i < t.length; i++) {
    if (lat[i] == null || lon[i] == null) continue;
    if (t[i] <= at) prev = i;
    else {
      next = i;
      break;
    }
  }
  if (prev === -1) {
    // Nothing recorded yet: hold at the first recorded point, stale.
    if (next === -1) return null;
    return { lat: lat[next]!, lon: lon[next]!, stale: true };
  }
  if (next === -1 || t[prev] === at) return { lat: lat[prev]!, lon: lon[prev]!, stale: false };

  // A gap wider than 2 buckets is a dropout: hold-and-dim, never bridge.
  if (t[next] - t[prev] > resolutionSeconds * 2) return { lat: lat[prev]!, lon: lon[prev]!, stale: true };

  const f = (at - t[prev]) / (t[next] - t[prev]);
  return {
    lat: lat[prev]! + (lat[next]! - lat[prev]!) * f,
    lon: lon[prev]! + (lon[next]! - lon[prev]!) * f,
    stale: false,
  };
}

/** The playback speed choices — multiples of ride-time. 60× = one ride-minute per second. */
export const PLAYBACK_SPEEDS = [30, 60, 300] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
