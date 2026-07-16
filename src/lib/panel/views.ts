import { todayISO } from "@/lib/date";
import { getDayRollup } from "@/lib/macros/repo";
import type { MacroSet } from "@/lib/macros/schema";
import { getList } from "@/lib/shopping/repo";
import { getRollup, listEntries as listWeightEntries } from "@/lib/weight/repo";
import { getPanelState } from "./repo";
import type { MacroQuad, NormalizedRecipe, PanelHealth, PanelRecipe, PanelShopping } from "./types";

/**
 * Panel section views (panel-contract §5). Read-only composition of the macros / weight / shopping
 * repos plus panel's own state — the panel is a cross-cutting aggregator, so importing sibling repos
 * here is expected (the same sanctioned coupling as the version bumps). Every number the panel shows
 * is computed HERE; the panel itself does no arithmetic.
 */

const WINDOW_DAYS = 30; // weight trend/series/range window (locked with the design)

const round1 = (n: number): number => Math.round(n * 10) / 10;

// ── health ───────────────────────────────────────────────────────────────────

/** `kind`-aware target pick. Specified day → that kind. Unspecified → the LOWER-CALORIE profile,
 *  wholesale (contract §5.1): conservative for the ceilings that drive "how much can I still eat". */
export function chooseTarget(
  kind: "training" | "rest" | "unspecified",
  targets: Partial<Record<"training" | "rest", MacroSet>>
): MacroSet | null {
  if (kind === "training") return targets.training ?? null;
  if (kind === "rest") return targets.rest ?? null;
  const { training, rest } = targets;
  if (training && rest) return (training.calories ?? Infinity) <= (rest.calories ?? Infinity) ? training : rest;
  return training ?? rest ?? null;
}

/** trend enum from the signed rate. Deadband = display precision: trendPerWeek is already rounded to
 *  0.1 lb/wk, so |x| < 0.05 means it renders "0.0" → flat. The glyph can never disagree with the number. */
export function trendEnum(trendPerWeek: number | null): "down" | "flat" | "up" | null {
  if (trendPerWeek == null) return null;
  if (Math.abs(trendPerWeek) < 0.05) return "flat";
  return trendPerWeek < 0 ? "down" : "up";
}

const quad = (m: MacroSet | null): MacroQuad => ({
  kcal: Math.round(m?.calories ?? 0),
  protein: Math.round(m?.proteinContent ?? 0),
  fat: Math.round(m?.fatContent ?? 0),
  carb: Math.round(m?.carbohydrateContent ?? 0),
});

export async function panelHealth(): Promise<PanelHealth> {
  const date = todayISO();
  const rollup = await getDayRollup(date);
  const dayType = rollup.day.kind === "unspecified" ? null : rollup.day.kind;

  const consumed = quad(rollup.totals);
  const target = quad(chooseTarget(rollup.day.kind, rollup.targets));
  const remaining: MacroQuad = {
    kcal: target.kcal - consumed.kcal,
    protein: target.protein - consumed.protein,
    fat: target.fat - consumed.fat,
    carb: target.carb - consumed.carb,
  };

  const { summary, series } = await getRollup({ window: WINDOW_DAYS });
  const avgs = series.map((p) => p.avg).filter((a): a is number => a != null);
  const { items } = await listWeightEntries({ limit: 1 }); // newest live weigh-in (measuredOn desc)
  const latest = items[0]
    ? { value: round1(items[0].weight), loggedAt: items[0].createdAt.toISOString() }
    : null;

  return {
    date,
    dayType,
    macros: { consumed, target, remaining },
    weight: {
      latest,
      rollingAvg7: summary.currentAvg,
      trend: trendEnum(summary.trendPerWeek),
      trendPerWeek: summary.trendPerWeek,
      windowDays: WINDOW_DAYS,
      series: series.map((p) => ({ date: p.date, avg: p.avg })),
      range: avgs.length ? { min: Math.min(...avgs), max: Math.max(...avgs) } : null,
    },
  };
}

// ── shopping ───────────────────────────────────────────────────────────────────

/**
 * The full panel list: all needed items + recently-bought (the same window the web UI uses, so a
 * mis-tap stays undoable) flattened to `{id, name, category, checked}`. `name` is the item's `text`.
 * counts.total = everything shown; counts.unchecked = needed.
 */
export async function panelShopping(): Promise<PanelShopping> {
  const list = await getList();
  const activeItems = list.active.flatMap((g) => g.items);
  const items = [
    ...activeItems.map((i) => ({ id: i.id, name: i.text, category: i.category, checked: false })),
    ...list.recentlyBought.map((i) => ({ id: i.id, name: i.text, category: i.category, checked: true })),
  ];
  return { items, counts: { total: items.length, unchecked: activeItems.length } };
}

// ── recipe ───────────────────────────────────────────────────────────────────

/** The active recipe (normalized). `recipe: null` is the normal empty state — 200, not 404. */
export async function panelRecipe(): Promise<PanelRecipe> {
  const state = await getPanelState();
  if (!state || state.activeRecipeNorm == null) {
    return { recipe: null, sentAt: null, sourceUrl: null };
  }
  return {
    recipe: state.activeRecipeNorm as NormalizedRecipe,
    sentAt: state.setAt ? state.setAt.toISOString() : null,
    sourceUrl: state.sourceUrl,
  };
}
