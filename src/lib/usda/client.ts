import type { FoodCreate } from "@/lib/macros/schema";

/**
 * USDA FoodData Central client — a thin module the resolver calls at most ONCE per new food
 * (on cache miss). It must never sit on the hot logging path; resolved foods are cached into
 * `macro_food` so repeated logging is a local lookup (HANDOFF-CODE "USDA / food catalog").
 */

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";

function apiKey(): string {
  const k = process.env.USDA_FDC_API_KEY;
  if (!k) throw new Error("USDA_FDC_API_KEY is not set");
  return k;
}

/** A single nutrient measurement on an FDC food (food-detail endpoint shape). */
type FdcNutrient = {
  nutrient?: { number?: string; name?: string; unitName?: string };
  amount?: number;
};

export type FdcFood = {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: FdcNutrient[];
};

export type FdcSearchHit = {
  fdcId: number;
  description: string;
  dataType?: string;
};

async function fdcGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${FDC_BASE}${path}`);
  url.searchParams.set("api_key", apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`FDC request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Search the catalog. Prefer the cleaner per-100g data types for logging. */
export async function searchFoods(query: string, opts: { pageSize?: number } = {}): Promise<FdcSearchHit[]> {
  const data = await fdcGet<{ foods?: FdcSearchHit[] }>("/foods/search", {
    query,
    pageSize: String(opts.pageSize ?? 10),
  });
  return (data.foods ?? []).map((f) => ({ fdcId: f.fdcId, description: f.description, dataType: f.dataType }));
}

export async function getFood(fdcId: number): Promise<FdcFood> {
  return fdcGet<FdcFood>(`/food/${fdcId}`);
}

// FDC nutrient numbers → our schema.org fields. Energy is picked by kcal unit (not the kJ row).
const NUTRIENT_NUMBERS = {
  proteinContent: "203",
  fatContent: "204",
  carbohydrateContent: "205",
  fiberContent: "291",
  sugarContent: "269",
  sodiumContent: "307", // reported in mg — converted to grams below
  saturatedFatContent: "606",
} as const;

/** Index a food's nutrients by number, keeping the first row with a usable amount + unit. */
function indexNutrients(food: FdcFood): Map<string, { amount: number; unit: string }> {
  const byNumber = new Map<string, { amount: number; unit: string }>();
  for (const n of food.foodNutrients ?? []) {
    const num = n.nutrient?.number;
    // Grouping rows (e.g. #951 "Proximates") have no amount — skip them.
    if (!num || typeof n.amount !== "number" || Number.isNaN(n.amount)) continue;
    const unit = (n.nutrient?.unitName ?? "").toUpperCase();
    if (!byNumber.has(num)) byNumber.set(num, { amount: n.amount, unit });
  }
  return byNumber;
}

/**
 * Map an FDC food to a per-100g `FoodCreate`. FDC amounts for Foundation / SR Legacy / Survey
 * are per-100g, matching our storage basis. Values that are absent or non-finite become null
 * (a food may know some macros but not others). Downstream this is validated by
 * `foodCreateSchema` before it ever reaches the repo.
 */
export function mapToFoodCreate(food: FdcFood): FoodCreate {
  const idx = indexNutrients(food);
  const val = (num: string): number | null => {
    const row = idx.get(num);
    return row ? row.amount : null;
  };

  // Energy: FDC carries both #208 (kcal) and #268 (kJ). Take the kcal row.
  let calories: number | null = null;
  for (const n of food.foodNutrients ?? []) {
    if (n.nutrient?.number === "208" && (n.nutrient?.unitName ?? "").toUpperCase() === "KCAL" && typeof n.amount === "number") {
      calories = n.amount;
      break;
    }
  }

  const sodiumMg = val(NUTRIENT_NUMBERS.sodiumContent);

  return {
    name: food.description,
    source: "usda",
    fdcId: food.fdcId,
    calories,
    proteinContent: val(NUTRIENT_NUMBERS.proteinContent),
    fatContent: val(NUTRIENT_NUMBERS.fatContent),
    carbohydrateContent: val(NUTRIENT_NUMBERS.carbohydrateContent),
    fiberContent: val(NUTRIENT_NUMBERS.fiberContent),
    sugarContent: val(NUTRIENT_NUMBERS.sugarContent),
    // Contract stores mass macros in grams; FDC reports sodium in mg.
    sodiumContent: sodiumMg == null ? null : sodiumMg / 1000,
    saturatedFatContent: val(NUTRIENT_NUMBERS.saturatedFatContent),
  };
}
