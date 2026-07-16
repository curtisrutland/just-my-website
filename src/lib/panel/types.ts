/** Panel domain types (panel-contract §5–6). Consumed by the panel views, routes, and UI — hence
 *  they live in `lib/panel`, never in `components` (the one-directional layering rule, AGENTS.md). */

/** The four targeted macros as the panel shows them: kcal + grams, plain numbers (contract §5.1). */
export type MacroQuad = { kcal: number; protein: number; fat: number; carb: number };

export type PanelHealth = {
  date: string; // today in Curtis's timezone
  dayType: "training" | "rest" | null; // null = unspecified
  macros: {
    consumed: MacroQuad;
    target: MacroQuad;
    remaining: MacroQuad; // signed — may be negative (over a ceiling); the panel does no arithmetic
  };
  weight: {
    latest: { value: number; loggedAt: string } | null; // newest raw reading; null if none
    rollingAvg7: number | null; // hero number; null if <2 readings in window
    trend: "down" | "flat" | "up" | null; // from trendPerWeek, deadband = display precision
    trendPerWeek: number | null; // signed lb/week (the on-screen "0.6 lb/wk")
    windowDays: number; // the span of series/trend/range
    series: { date: string; avg: number | null }[]; // 7-day rolling avg per day (the sparkline)
    range: { min: number; max: number } | null; // extent of the avg series (the plotted line)
  };
};

export type PanelShoppingItem = { id: string; name: string; category: string; checked: boolean };
export type PanelShopping = {
  items: PanelShoppingItem[];
  counts: { total: number; unchecked: number };
};

/** The normalized recipe stored in `panel_state.active_recipe_norm` and returned by /recipe (§6.4). */
export type PanelRecipeStep = { heading: string | null; text: string };
export type PanelRecipeNutrition = {
  calories: number | null;
  proteinContent: number | null;
  fatContent: number | null;
  carbohydrateContent: number | null;
};
export type NormalizedRecipe = {
  name: string;
  description: string | null;
  recipeYield: string | null; // string ("6 bites"), not always numeric
  totalTime: string | null; // ISO 8601 duration, e.g. "PT1H20M" — the viewer formats it
  ingredients: string[]; // flat free-text
  steps: PanelRecipeStep[]; // heading nullable
  notes: string | null; // freeform, may be long; NOT schema.org (§6.5)
  nutrition: PanelRecipeNutrition | null; // per serving
};
export type PanelRecipe = {
  recipe: NormalizedRecipe | null; // null = nothing sent (a normal, expected state)
  sentAt: string | null;
  sourceUrl: string | null;
};
