import type { NormalizedRecipe, PanelRecipeNutrition, PanelRecipeStep } from "./types";

/**
 * Send-to-panel: validation + normalization on RECEIVE, never on render (panel-contract §6.3–6.4).
 * The panel must never be the thing that discovers a malformed payload, and the schema.org
 * raggedness of `recipeInstructions` is flattened here so the lowest-powered part of the system
 * (the Pi renderer) branches on nothing.
 *
 * The live sender (justmy.recipes) only ever emits `HowToStep[]`, but the endpoint is
 * sender-anonymous (§6.1), so the normalizer handles the full general case: a bare string, an array
 * of strings, an array of HowToStep, and HowToSection objects with nested steps (and mixtures).
 */

// ── small coercions ────────────────────────────────────────────────────────────

function strOrNull(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t === "" ? null : t;
}

/** schema.org lets numeric-ish fields be numbers OR strings ("22 g"). Pull the leading number. */
function parseNum(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const m = x.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

/** recipeYield may be a string ("6 bites"), a number (6), or an array; the panel wants a string. */
function coerceYield(x: unknown): string | null {
  if (typeof x === "string") return strOrNull(x);
  if (typeof x === "number") return String(x);
  if (Array.isArray(x) && x.length) return coerceYield(x[0]);
  return null;
}

function typeList(x: unknown): string[] {
  if (Array.isArray(x)) return x.map(String);
  return x != null ? [String(x)] : [];
}

// ── ingredients ──────────────────────────────────────────────────────────────

function normalizeIngredients(x: unknown): string[] {
  if (Array.isArray(x)) return x.map((i) => strOrNull(i)).filter((s): s is string => s != null);
  const one = strOrNull(x);
  return one ? [one] : [];
}

// ── instructions → flat steps ──────────────────────────────────────────────────

/** One instruction element (string | HowToStep | HowToSection | other) → zero or more flat steps.
 *  `inherited` is the enclosing HowToSection's name, used as a step heading when the step has none. */
function flattenElement(el: unknown, inherited: string | null): PanelRecipeStep[] {
  if (el == null) return [];

  // A bare string element: split on line breaks (a common "one step per line" shape); else one step.
  if (typeof el === "string") {
    return el
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ heading: inherited, text }));
  }

  if (typeof el === "object") {
    const o = el as Record<string, unknown>;
    const types = typeList(o["@type"]);

    // HowToSection: a heading + nested itemListElement steps (recurse, carrying the section name).
    if (types.includes("HowToSection") || o.itemListElement != null) {
      const section = strOrNull(o.name) ?? inherited;
      const items = o.itemListElement;
      const arr = Array.isArray(items) ? items : items != null ? [items] : [];
      return arr.flatMap((child) => flattenElement(child, section));
    }

    // HowToStep (or any object carrying text): `text` is the instruction, `name` a short heading.
    const text = strOrNull(o.text) ?? strOrNull(o.name);
    if (!text) return [];
    const hasBoth = strOrNull(o.text) != null && strOrNull(o.name) != null;
    return [{ heading: hasBoth ? strOrNull(o.name) : inherited, text }];
  }

  return [];
}

/** recipeInstructions (any schema.org shape) → a flat, viewer-ready step list. */
export function normalizeInstructions(instr: unknown): PanelRecipeStep[] {
  if (instr == null) return [];
  if (Array.isArray(instr)) return instr.flatMap((el) => flattenElement(el, null));
  return flattenElement(instr, null);
}

// ── nutrition ──────────────────────────────────────────────────────────────────

function normalizeNutrition(x: unknown): PanelRecipeNutrition | null {
  if (typeof x !== "object" || x === null) return null;
  const n = x as Record<string, unknown>;
  return {
    calories: parseNum(n.calories),
    proteinContent: parseNum(n.proteinContent),
    fatContent: parseNum(n.fatContent),
    carbohydrateContent: parseNum(n.carbohydrateContent),
  };
}

// ── the normalizer ──────────────────────────────────────────────────────────────

/** A validated recipe object → the flat `active_recipe_norm` shape (contract §6.4). Pure. */
export function normalizeRecipe(raw: Record<string, unknown>): NormalizedRecipe {
  return {
    name: strOrNull(raw.name) ?? "",
    description: strOrNull(raw.description),
    recipeYield: coerceYield(raw.recipeYield),
    totalTime: strOrNull(raw.totalTime),
    ingredients: normalizeIngredients(raw.recipeIngredient),
    steps: normalizeInstructions(raw.recipeInstructions),
    notes: strOrNull(raw.notes), // NOT schema.org — carried through (§6.5)
    nutrition: normalizeNutrition(raw.nutrition),
  };
}

// ── validation (on receive) ──────────────────────────────────────────────────

export type SendValidation =
  | { ok: true; recipe: Record<string, unknown>; sourceUrl: string | null }
  | { ok: false; errors: string[] };

function isNonEmpty(x: unknown): boolean {
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === "string") return x.trim() !== "";
  return x != null && typeof x === "object";
}

/**
 * Minimum accept criteria (§6.3). Unknown fields are preserved, never rejected. Leniency choice: a
 * bare object WITHOUT `@type` is accepted; `@type` present but not "Recipe" is rejected. Returns the
 * (unmodified) recipe object + sourceUrl on success, or a list of human-readable errors.
 */
export function validateSendPayload(body: unknown): SendValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["Body must be a JSON object with a `recipe`."] };
  }
  const b = body as Record<string, unknown>;
  const recipe = b.recipe;
  if (typeof recipe !== "object" || recipe === null || Array.isArray(recipe)) {
    return { ok: false, errors: ["`recipe` must be a JSON-LD Recipe object."] };
  }
  const r = recipe as Record<string, unknown>;
  const errors: string[] = [];

  const types = typeList(r["@type"]);
  if (types.length > 0 && !types.includes("Recipe")) {
    errors.push('`@type` must be "Recipe" (or omitted).');
  }
  if (typeof r.name !== "string" || r.name.trim() === "") {
    errors.push("`name` must be a non-empty string.");
  }
  if (!isNonEmpty(r.recipeIngredient) && !isNonEmpty(r.recipeInstructions)) {
    errors.push("At least one of `recipeIngredient` or `recipeInstructions` must be present and non-empty.");
  }

  if (errors.length) return { ok: false, errors };
  const sourceUrl = typeof b.sourceUrl === "string" && b.sourceUrl.trim() ? b.sourceUrl.trim() : null;
  return { ok: true, recipe: r, sourceUrl };
}
