import { and, asc, count, desc, eq, gte, ilike, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  macroDayTag,
  macroEntry,
  macroFood,
  macroTargetProfile,
  type MacroDayTag,
  type MacroEntry,
  type MacroFood,
  type MacroTargetProfile,
} from "@/lib/db/schema";
import type {
  DayTagCreate,
  DayTagPatch,
  EntryCreate,
  EntryPatch,
  FoodCreate,
  FoodPatch,
  MacroSet,
  TargetProfileCreate,
  TargetProfilePatch,
} from "./schema";

/**
 * Macro module — repository. The ONLY place macro tables are touched (CONVENTIONS §1). Both
 * read surfaces (server component, API route) call these; writes arrive already validated by
 * schema.ts. Reads exclude soft-deleted rows by default (`deletedAt IS NULL`).
 */

const NUTRITION_KEYS = [
  "calories",
  "proteinContent",
  "fatContent",
  "carbohydrateContent",
  "fiberContent",
  "sugarContent",
  "sodiumContent",
  "saturatedFatContent",
] as const;

type Page = { limit?: number; offset?: number };
export type Paged<T> = { items: T[]; count: number };

const live = (deletedAt: unknown) => isNull(deletedAt as never);

// ─────────────────────────────────────────────────────────── Foods ───────────

export async function createFood(input: FoodCreate): Promise<MacroFood> {
  const [row] = await db.insert(macroFood).values(input).returning();
  return row;
}

export async function getFoodById(id: string): Promise<MacroFood | null> {
  const [row] = await db
    .select()
    .from(macroFood)
    .where(and(eq(macroFood.id, id), live(macroFood.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Cache lookup for USDA resolution — find a live cached food by its FoodData Central id. */
export async function findLiveFoodByFdcId(fdcId: number): Promise<MacroFood | null> {
  const [row] = await db
    .select()
    .from(macroFood)
    .where(and(eq(macroFood.fdcId, fdcId), live(macroFood.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function listFoods(opts: Page & { q?: string } = {}): Promise<Paged<MacroFood>> {
  const { limit = 50, offset = 0, q } = opts;
  const where = q
    ? and(live(macroFood.deletedAt), ilike(macroFood.name, `%${q}%`))
    : live(macroFood.deletedAt);
  const items = await db
    .select()
    .from(macroFood)
    .where(where)
    .orderBy(asc(macroFood.name))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(macroFood).where(where);
  return { items, count: c };
}

export async function patchFood(id: string, patch: FoodPatch): Promise<MacroFood | null> {
  if (Object.keys(patch).length === 0) return getFoodById(id);
  const [row] = await db
    .update(macroFood)
    .set(patch)
    .where(and(eq(macroFood.id, id), live(macroFood.deletedAt)))
    .returning();
  return row ?? null;
}

export async function softDeleteFood(id: string): Promise<boolean> {
  const [row] = await db
    .update(macroFood)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroFood.id, id), live(macroFood.deletedAt)))
    .returning({ id: macroFood.id });
  return !!row;
}

/** Hard delete — physically removes the row. Auth layer gates this to the primary key. */
export async function hardDeleteFood(id: string): Promise<boolean> {
  const [row] = await db.delete(macroFood).where(eq(macroFood.id, id)).returning({ id: macroFood.id });
  return !!row;
}

// ────────────────────────────────────────────────────────── Entries ──────────

type MacroColumns = Record<(typeof NUTRITION_KEYS)[number], number | null>;

/** Derive absolute snapshot macros: caller-supplied values win; the rest come from the food's
 *  per-100g values × quantity. Snapshotting freezes the entry as an immutable fact. */
async function snapshotMacros(input: EntryCreate): Promise<MacroColumns> {
  const needsDerivation = input.foodId != null && NUTRITION_KEYS.some((k) => input[k] == null);
  const food: MacroFood | null = needsDerivation ? await getFoodById(input.foodId!) : null;

  const factor = input.quantityGrams / 100;
  const out = {} as MacroColumns;
  for (const k of NUTRITION_KEYS) {
    const supplied = input[k];
    if (supplied != null) out[k] = supplied;
    else if (food && food[k] != null) out[k] = (food[k] as number) * factor;
    else out[k] = null;
  }
  return out;
}

export async function createEntry(input: EntryCreate): Promise<MacroEntry> {
  const macros = await snapshotMacros(input);
  const [row] = await db
    .insert(macroEntry)
    .values({
      name: input.name ?? null,
      consumedOn: input.consumedOn,
      foodId: input.foodId ?? null,
      quantityGrams: input.quantityGrams,
      confidence: input.confidence,
      note: input.note ?? null,
      ...macros,
    })
    .returning();
  return row;
}

export async function getEntryById(id: string): Promise<MacroEntry | null> {
  const [row] = await db
    .select()
    .from(macroEntry)
    .where(and(eq(macroEntry.id, id), live(macroEntry.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function listEntries(opts: Page & { on?: string } = {}): Promise<Paged<MacroEntry>> {
  const { limit = 50, offset = 0, on } = opts;
  const where = on
    ? and(live(macroEntry.deletedAt), eq(macroEntry.consumedOn, on))
    : live(macroEntry.deletedAt);
  const items = await db
    .select()
    .from(macroEntry)
    .where(where)
    .orderBy(desc(macroEntry.consumedOn), asc(macroEntry.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(macroEntry).where(where);
  return { items, count: c };
}

export async function patchEntry(id: string, patch: EntryPatch): Promise<MacroEntry | null> {
  if (Object.keys(patch).length === 0) return getEntryById(id);
  const [row] = await db
    .update(macroEntry)
    .set(patch)
    .where(and(eq(macroEntry.id, id), live(macroEntry.deletedAt)))
    .returning();
  return row ?? null;
}

export async function softDeleteEntry(id: string): Promise<boolean> {
  const [row] = await db
    .update(macroEntry)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroEntry.id, id), live(macroEntry.deletedAt)))
    .returning({ id: macroEntry.id });
  return !!row;
}

export async function hardDeleteEntry(id: string): Promise<boolean> {
  const [row] = await db.delete(macroEntry).where(eq(macroEntry.id, id)).returning({ id: macroEntry.id });
  return !!row;
}

// ────────────────────────────────────────────────────────── Day tags ─────────

/** Upsert a day's kind. One live tag per day: if a live tag exists we update it, else insert. */
export async function setDayTag(input: DayTagCreate): Promise<MacroDayTag> {
  const existing = await getLiveDayTag(input.day);
  if (existing) {
    const [row] = await db
      .update(macroDayTag)
      .set({ kind: input.kind })
      .where(eq(macroDayTag.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(macroDayTag).values(input).returning();
  return row;
}

export async function getLiveDayTag(day: string): Promise<MacroDayTag | null> {
  const [row] = await db
    .select()
    .from(macroDayTag)
    .where(and(eq(macroDayTag.day, day), live(macroDayTag.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function patchDayTag(day: string, patch: DayTagPatch): Promise<MacroDayTag | null> {
  const existing = await getLiveDayTag(day);
  if (!existing) return null;
  if (Object.keys(patch).length === 0) return existing;
  const [row] = await db.update(macroDayTag).set(patch).where(eq(macroDayTag.id, existing.id)).returning();
  return row ?? null;
}

export async function softDeleteDayTag(day: string): Promise<boolean> {
  const [row] = await db
    .update(macroDayTag)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroDayTag.day, day), live(macroDayTag.deletedAt)))
    .returning({ id: macroDayTag.id });
  return !!row;
}

export async function hardDeleteDayTag(id: string): Promise<boolean> {
  const [row] = await db.delete(macroDayTag).where(eq(macroDayTag.id, id)).returning({ id: macroDayTag.id });
  return !!row;
}

/** Live day-kinds within [from, to] as a { date: kind } map (absent days omitted → unspecified). */
export async function dayKindsBetween(from: string, to: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ day: macroDayTag.day, kind: macroDayTag.kind })
    .from(macroDayTag)
    .where(and(gte(macroDayTag.day, from), lte(macroDayTag.day, to), live(macroDayTag.deletedAt)));
  return Object.fromEntries(rows.map((r) => [r.day, r.kind]));
}

// ──────────────────────────────────────────────────── Target profiles ────────

export async function createTargetProfile(input: TargetProfileCreate): Promise<MacroTargetProfile> {
  const [row] = await db.insert(macroTargetProfile).values(input).returning();
  return row;
}

export async function listTargetProfiles(opts: Page & { kind?: string } = {}): Promise<Paged<MacroTargetProfile>> {
  const { limit = 50, offset = 0, kind } = opts;
  const where = kind
    ? and(live(macroTargetProfile.deletedAt), eq(macroTargetProfile.kind, kind))
    : live(macroTargetProfile.deletedAt);
  const items = await db
    .select()
    .from(macroTargetProfile)
    .where(where)
    .orderBy(asc(macroTargetProfile.kind), desc(macroTargetProfile.effectiveFrom))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(macroTargetProfile).where(where);
  return { items, count: c };
}

export async function patchTargetProfile(id: string, patch: TargetProfilePatch): Promise<MacroTargetProfile | null> {
  if (Object.keys(patch).length === 0) {
    const [row] = await db
      .select()
      .from(macroTargetProfile)
      .where(and(eq(macroTargetProfile.id, id), live(macroTargetProfile.deletedAt)))
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .update(macroTargetProfile)
    .set(patch)
    .where(and(eq(macroTargetProfile.id, id), live(macroTargetProfile.deletedAt)))
    .returning();
  return row ?? null;
}

export async function softDeleteTargetProfile(id: string): Promise<boolean> {
  const [row] = await db
    .update(macroTargetProfile)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroTargetProfile.id, id), live(macroTargetProfile.deletedAt)))
    .returning({ id: macroTargetProfile.id });
  return !!row;
}

export async function hardDeleteTargetProfile(id: string): Promise<boolean> {
  const [row] = await db
    .delete(macroTargetProfile)
    .where(eq(macroTargetProfile.id, id))
    .returning({ id: macroTargetProfile.id });
  return !!row;
}

/** Resolve the target of `kind` in effect on `date`: latest effectiveFrom <= date, live. */
export async function resolveTarget(kind: string, date: string): Promise<MacroSet | null> {
  const [row] = await db
    .select()
    .from(macroTargetProfile)
    .where(
      and(
        eq(macroTargetProfile.kind, kind),
        lte(macroTargetProfile.effectiveFrom, date),
        live(macroTargetProfile.deletedAt)
      )
    )
    .orderBy(desc(macroTargetProfile.effectiveFrom))
    .limit(1);
  if (!row) return null;
  return {
    calories: row.calories,
    proteinContent: row.proteinContent,
    fatContent: row.fatContent,
    carbohydrateContent: row.carbohydrateContent,
  };
}

// ──────────────────────────────────────────────────────── Day rollup ─────────

export type RollupEntry = {
  id: string;
  consumedOn: string;
  foodName: string | null;
  quantityGrams: number;
  confidence: string;
  note: string | null;
  calories: number | null;
  proteinContent: number | null;
  fatContent: number | null;
  carbohydrateContent: number | null;
};

export type DayRollup = {
  day: { date: string; kind: "training" | "rest" | "unspecified" };
  totals: MacroSet;
  estimation: { estimatedFraction: number; entryCount: number; estimatedCount: number };
  targets: Partial<Record<"training" | "rest", MacroSet>>;
  entries: RollupEntry[];
};

/**
 * The day-rollup (HANDOFF-CODE "the one thing the recipes template can't guide"). Sums the
 * day's live entries, computes the estimated-calorie fraction, resolves the day's kind, and
 * resolves target(s) — returning BOTH training and rest when the day is unspecified.
 */
export async function getDayRollup(date: string): Promise<DayRollup> {
  const rows = await db
    .select({
      id: macroEntry.id,
      consumedOn: macroEntry.consumedOn,
      // The entry's own label wins; fall back to a linked food's name.
      foodName: sql<string | null>`coalesce(${macroEntry.name}, ${macroFood.name})`,
      quantityGrams: macroEntry.quantityGrams,
      confidence: macroEntry.confidence,
      note: macroEntry.note,
      calories: macroEntry.calories,
      proteinContent: macroEntry.proteinContent,
      fatContent: macroEntry.fatContent,
      carbohydrateContent: macroEntry.carbohydrateContent,
    })
    .from(macroEntry)
    .leftJoin(macroFood, eq(macroEntry.foodId, macroFood.id))
    .where(and(eq(macroEntry.consumedOn, date), live(macroEntry.deletedAt)))
    .orderBy(asc(macroEntry.createdAt));

  const totals: MacroSet = { calories: 0, proteinContent: 0, fatContent: 0, carbohydrateContent: 0 };
  let estimatedCalories = 0;
  let totalCalories = 0;
  let estimatedCount = 0;

  for (const r of rows) {
    totals.calories! += r.calories ?? 0;
    totals.proteinContent! += r.proteinContent ?? 0;
    totals.fatContent! += r.fatContent ?? 0;
    totals.carbohydrateContent! += r.carbohydrateContent ?? 0;
    totalCalories += r.calories ?? 0;
    if (r.confidence === "estimated") {
      estimatedCount += 1;
      estimatedCalories += r.calories ?? 0;
    }
  }

  const estimatedFraction = totalCalories > 0 ? estimatedCalories / totalCalories : 0;

  const tag = await getLiveDayTag(date);
  const kind = (tag?.kind as "training" | "rest" | undefined) ?? "unspecified";

  const targets: Partial<Record<"training" | "rest", MacroSet>> = {};
  if (kind === "unspecified") {
    // Dual-target: resolve BOTH so the UI can show "on target if training, N over if rest".
    const [training, rest] = await Promise.all([resolveTarget("training", date), resolveTarget("rest", date)]);
    if (training) targets.training = training;
    if (rest) targets.rest = rest;
  } else {
    const t = await resolveTarget(kind, date);
    if (t) targets[kind] = t;
  }

  return {
    day: { date, kind },
    totals,
    estimation: { estimatedFraction, entryCount: rows.length, estimatedCount },
    targets,
    entries: rows,
  };
}
