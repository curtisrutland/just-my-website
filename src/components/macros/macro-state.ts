import type { MacroSet } from "@/lib/macros/types";

/**
 * Target-state color rules and track geometry (docs/design-reference/DESIGN-HANDOFF.md §3).
 * Kept exact: these drive the fill color that embodies honesty-about-fuzziness.
 *
 * One target per day. The rest/training corridor these helpers used to render came from
 * calorie cycling, which is retired along with the day-type field.
 */

export type MacroKey = "calories" | "proteinContent" | "fatContent" | "carbohydrateContent";

/** The day's target for one macro, or null when no profile applies (or the profile omits it). */
export function targetFor(target: MacroSet | null, key: MacroKey): number | null {
  return target?.[key] ?? null;
}

export type BarState = { word: string; color: string };

export function barState(value: number, target: number | null): BarState {
  if (target == null) return { word: "no target", color: "var(--color-text-muted)" };
  const ratio = value / target;
  if (ratio < 0.9) return { word: "under", color: "var(--color-text-muted)" };
  if (ratio <= 1.02) return { word: "on target", color: "var(--color-success)" };
  if (ratio <= 1.1) return { word: "slightly over", color: "var(--color-warning)" };
  return { word: "over", color: "var(--color-over)" };
}

/** Track scale: value and target share max × 1.15 so the fill never pins the edge. */
export function scaleFor(value: number, target: number | null): (x: number) => number {
  const points = [value, target].filter((n): n is number => n != null && n > 0);
  const scaleMax = Math.max(...points, 1) * 1.15;
  return (x: number) => Math.max(0, Math.min(100, (x / scaleMax) * 100));
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Summary line beneath a target track, e.g. "+180 vs target". */
export function trackSummary(value: number, target: number | null): string {
  if (target == null) return "no target set";
  const delta = Math.round(value - target);
  const sign = delta < 0 ? "−" : "+";
  return `${sign}${fmt(Math.abs(delta))} vs target`;
}

/** Target caption, e.g. "target 300 g". */
export function targetCaption(target: number | null, unit: "g" | "kcal"): string {
  if (target == null) return "no target";
  return `target ${fmt(target)} ${unit}`;
}
