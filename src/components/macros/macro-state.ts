import type { MacroSet } from "@/lib/macros/types";

/**
 * Target-state color rules and track geometry (docs/design-reference/DESIGN-HANDOFF.md §3).
 * Kept exact: these drive the fill color that embodies honesty-about-fuzziness.
 */

export type MacroKey = "calories" | "proteinContent" | "fatContent" | "carbohydrateContent";

/** Resolved target(s) for one macro: a single value, or a rest/training corridor. */
export type TrackTargets = { single?: number | null; rest?: number | null; train?: number | null };

/** Collapse the day's target(s) for one macro into single vs dual (rest==train ⇒ single). */
export function resolveTargets(
  targets: { training?: MacroSet; rest?: MacroSet },
  key: MacroKey
): TrackTargets {
  const train = targets.training?.[key] ?? null;
  const rest = targets.rest?.[key] ?? null;
  if (train != null && rest != null) {
    return train === rest ? { single: train } : { rest, train };
  }
  return { single: train ?? rest ?? null };
}

export type BarState = { word: string; color: string };

function singleState(value: number, target: number): BarState {
  const ratio = value / target;
  if (ratio < 0.9) return { word: "under", color: "var(--color-text-muted)" };
  if (ratio <= 1.02) return { word: "on target", color: "var(--color-success)" };
  if (ratio <= 1.1) return { word: "slightly over", color: "var(--color-warning)" };
  return { word: "over", color: "var(--color-over)" };
}

export function barState(value: number, t: TrackTargets): BarState {
  if (t.rest != null && t.train != null) {
    const lo = Math.min(t.rest, t.train);
    const hi = Math.max(t.rest, t.train);
    if (value < lo) return { word: "under both", color: "var(--color-text-muted)" };
    if (value <= hi) return { word: "in range", color: "var(--color-accent)" };
    return { word: "over both", color: "var(--color-over)" };
  }
  if (t.single != null) return singleState(value, t.single);
  return { word: "no target", color: "var(--color-text-muted)" };
}

/** Track scale: all points share max(value, targets) × 1.15 so the fill never pins the edge. */
export function scaleFor(value: number, t: TrackTargets): (x: number) => number {
  const points = [value, t.single, t.rest, t.train].filter((n): n is number => n != null && n > 0);
  const scaleMax = Math.max(...points, 1) * 1.15;
  return (x: number) => Math.max(0, Math.min(100, (x / scaleMax) * 100));
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Summary line beneath a target track, e.g. "560 under training · 40 over rest" (dual). */
export function trackSummary(value: number, t: TrackTargets, unit: "g" | "kcal"): string {
  const u = unit === "kcal" ? "" : "";
  const side = (target: number, label: string) => {
    const delta = Math.round(value - target);
    if (delta === 0) return `on ${label}`;
    return delta < 0 ? `${fmt(-delta)}${u} under ${label}` : `${fmt(delta)}${u} over ${label}`;
  };
  if (t.rest != null && t.train != null) {
    return `${side(t.train, "training")} · ${side(t.rest, "rest")}`;
  }
  if (t.single != null) {
    const delta = Math.round(value - t.single);
    const sign = delta < 0 ? "−" : "+";
    return `${sign}${fmt(Math.abs(delta))} vs target`;
  }
  return "no target set";
}

/** Target caption, e.g. "target 200–300 g" (dual) or "target 300 g" (single). */
export function targetCaption(t: TrackTargets, unit: "g" | "kcal"): string {
  if (t.rest != null && t.train != null) {
    const lo = Math.min(t.rest, t.train);
    const hi = Math.max(t.rest, t.train);
    return `target ${fmt(lo)}–${fmt(hi)} ${unit}`;
  }
  if (t.single != null) return `target ${fmt(t.single)} ${unit}`;
  return "no target";
}
