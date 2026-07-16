import type { PanelHealth } from "./types";

/**
 * DEV-ONLY state fudging for reviewing the panel without touching server data. The health page only
 * calls this when `NODE_ENV !== "production"` AND a `?demo=` param is present, so it can never affect
 * real data or ship. Targets stay real (from the live profile); only consumed/weight are overridden.
 *
 * States: fresh · protein-met · over · no-weight · gaining
 */
export function applyHealthDemo(base: PanelHealth, state: string): PanelHealth {
  const t = base.macros.target;
  const round = (n: number) => Math.round(n);
  const withConsumed = (
    consumed: PanelHealth["macros"]["consumed"],
    dayType: PanelHealth["dayType"] = base.dayType
  ): PanelHealth => ({
    ...base,
    dayType,
    macros: {
      consumed,
      target: t,
      remaining: {
        kcal: t.kcal - consumed.kcal,
        protein: t.protein - consumed.protein,
        fat: t.fat - consumed.fat,
        carb: t.carb - consumed.carb,
      },
    },
  });

  switch (state) {
    case "fresh": // 7am — nothing logged yet
      return withConsumed({ kcal: 0, protein: 0, fat: 0, carb: 0 });
    case "protein-met": // protein floor reached → green; everything else still has room
      return withConsumed({ kcal: round(t.kcal * 0.7), protein: t.protein + 8, fat: round(t.fat * 0.6), carb: round(t.carb * 0.6) });
    case "over": // over the kcal + fat ceilings → amber hero + OVER badge, amber fat card
      return withConsumed({ kcal: t.kcal + 180, protein: t.protein + 22, fat: t.fat + 12, carb: t.carb + 30 });
    case "no-weight": // fewer than 2 readings in window → empty weight card
      return { ...base, weight: { latest: null, rollingAvg7: null, trend: null, trendPerWeek: null, windowDays: base.weight.windowDays, series: [], range: null } };
    case "gaining": // weight trend up → amber trend readout
      return { ...base, weight: { ...base.weight, trend: "up", trendPerWeek: 0.4 } };
    default:
      return base;
  }
}
