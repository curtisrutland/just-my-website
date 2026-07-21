/**
 * Lifting module — weight display units. Curtis logs and thinks in whole POUNDS; kg is only Hevy's
 * canonical storage, and it's usually a noisy float from an lb→kg conversion (a 40 lb set is stored
 * `18.143717`). Nothing user-facing should ever show a decimal or a kg value.
 *
 * The single rule, owned here so no component re-invents it: convert canonical kg to the **nearest
 * whole pound** for display. Because every weight originates as a whole-lb entry in Hevy, rounding
 * to the nearest whole pound recovers the exact weight Curtis actually lifted (e.g. `18.143717` →
 * 40). Weight, top-set, e1RM, tonnage, and PR values all go through this before rendering.
 */

/** Pounds per kilogram (exact inverse of the international-pound definition, 0.45359237 kg/lb). */
export const LB_PER_KG = 1 / 0.45359237; // 2.2046226218…

/**
 * Canonical kg → whole pounds for display. Null passes through (bodyweight / timed sets carry no
 * weight). Always returns an integer — the "closest real lb weight" Curtis would have lifted.
 */
export function kgToLb(kg: number | null | undefined): number | null {
  if (kg == null) return null;
  return Math.round(kg * LB_PER_KG);
}
