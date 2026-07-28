import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, sql, sum } from "drizzle-orm";
import { dateRange } from "@/lib/date";
import { db } from "@/lib/db";
import {
  macroBatch,
  macroDayTag,
  macroEntry,
  macroFood,
  macroTargetProfile,
  type MacroBatch,
  type MacroDayTag,
  type MacroEntry,
  type MacroFood,
  type MacroTargetProfile,
} from "@/lib/db/schema";
import { bump } from "@/lib/panel/version";
import type {
  BatchBasis,
  BatchCreate,
  BatchDetailView,
  BatchPatch,
  BatchView,
  DayTagCreate,
  DayTagPatch,
  EntryCreate,
  EntryPatch,
  EntryView,
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
 *
 * Mutations that change what the panel's health screen shows — entries, day tags, target profiles
 * — call `bump("health")` AFTER they commit so the panel's version poll notices (panel-contract
 * §4.2). Food-catalog and batch writes do NOT bump (entries snapshot nutrition at log time, so
 * editing a food or batch doesn't change today's totals). Fire-and-forget; never fails a write.
 * New write paths MUST bump.
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

/**
 * The ONE entry projection every read path returns (`EntryView`). Both `listEntries` and
 * `getDayRollup` select through this so the two endpoints hand back an identical entry object —
 * same keys, same macro set. `name` is resolved here (the entry's own label, else the linked
 * food's, else the linked batch's), which is why callers must `leftJoin(macroFood)` AND
 * `leftJoin(macroBatch)`. Confidence comes back as the DB's
 * `text`; the shape is asserted to `EntryView` at the call site (writes constrain it to the enum).
 */
const entrySelection = {
  id: macroEntry.id,
  name: sql<string | null>`coalesce(${macroEntry.name}, ${macroFood.name}, ${macroBatch.name})`,
  consumedOn: macroEntry.consumedOn,
  foodId: macroEntry.foodId,
  batchId: macroEntry.batchId,
  quantityGrams: macroEntry.quantityGrams,
  confidence: macroEntry.confidence,
  note: macroEntry.note,
  calories: macroEntry.calories,
  proteinContent: macroEntry.proteinContent,
  fatContent: macroEntry.fatContent,
  carbohydrateContent: macroEntry.carbohydrateContent,
  fiberContent: macroEntry.fiberContent,
  sugarContent: macroEntry.sugarContent,
  sodiumContent: macroEntry.sodiumContent,
  saturatedFatContent: macroEntry.saturatedFatContent,
} as const;

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

export async function listFoods(
  opts: Page & { q?: string; category?: string; brand?: string } = {}
): Promise<Paged<MacroFood>> {
  const { limit = 50, offset = 0, q, category, brand } = opts;
  // Fuzzy name (ilike %q%) + exact category + case-insensitive exact brand. The brand+category
  // pair is the dedupe cohort (register_ingredient searches it before inserting).
  const conds = [live(macroFood.deletedAt)];
  if (q) conds.push(ilike(macroFood.name, `%${q}%`));
  if (category) conds.push(eq(macroFood.category, category));
  if (brand) conds.push(ilike(macroFood.brand, brand));
  const where = and(...conds);
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

// ────────────────────────────────────────────────────────── Batches ──────────

/**
 * A domain-rule violation the routes translate into an envelope error (unlike not-found nulls,
 * these carry a reason the caller must see — e.g. WHICH batch is finished and since when).
 */
export class MacroDomainError extends Error {
  constructor(
    readonly code: "batch_not_found" | "batch_finished" | "batch_dates_invalid" | "food_xor_batch",
    message: string
  ) {
    super(message);
    this.name = "MacroDomainError";
  }
}

/** Status is DERIVED from finishedOn — never stored, and never left for the caller to infer. */
const batchToView = (b: MacroBatch): BatchView => ({
  id: b.id,
  name: b.name,
  status: b.finishedOn == null ? "active" : "finished",
  madeOn: b.madeOn,
  finishedOn: b.finishedOn,
  initialGrams: b.initialGrams,
  basis: (b.basis as BatchBasis | null) ?? null,
  note: b.note,
  calories: b.calories,
  proteinContent: b.proteinContent,
  fatContent: b.fatContent,
  carbohydrateContent: b.carbohydrateContent,
  fiberContent: b.fiberContent,
  sugarContent: b.sugarContent,
  sodiumContent: b.sodiumContent,
  saturatedFatContent: b.saturatedFatContent,
});

async function getBatchRowById(id: string): Promise<MacroBatch | null> {
  const [row] = await db
    .select()
    .from(macroBatch)
    .where(and(eq(macroBatch.id, id), live(macroBatch.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * The draw guard: a finished batch rejects draws — with one honest exception, an entry dated
 * on/before the finish date (late logging must not force an unfinish/refinish dance). Runs even
 * when the entry supplies its own macros: the lifecycle rule is about the batch, not the math.
 * Returns the live row so the snapshot path doesn't re-fetch.
 */
async function assertDrawableBatch(batchId: string, consumedOn: string): Promise<MacroBatch> {
  const batch = await getBatchRowById(batchId);
  if (!batch) throw new MacroDomainError("batch_not_found", "Batch not found");
  if (batch.finishedOn != null && consumedOn > batch.finishedOn) {
    throw new MacroDomainError(
      "batch_finished",
      `Batch "${batch.name}" was finished on ${batch.finishedOn}; an entry consumed ${consumedOn} cannot draw from it. Register a new batch, or backdate the entry to on/before ${batch.finishedOn}.`
    );
  }
  return batch;
}

/**
 * Register a batch. Never blocks on an active same-name batch — it SURFACES it (the dedupe-on-
 * write pattern): a non-empty `activeNameMatches` usually means the old generation should have
 * been finished, and the agent asks. No bump: batch writes change no day's totals.
 */
export async function createBatch(
  input: BatchCreate
): Promise<{ batch: BatchView; activeNameMatches: BatchView[] }> {
  const [row] = await db.insert(macroBatch).values(input).returning();
  const matches = await db
    .select()
    .from(macroBatch)
    .where(
      and(
        live(macroBatch.deletedAt),
        isNull(macroBatch.finishedOn),
        ilike(macroBatch.name, input.name),
        ne(macroBatch.id, row.id)
      )
    )
    .orderBy(desc(macroBatch.madeOn));
  return { batch: batchToView(row), activeNameMatches: matches.map(batchToView) };
}

/**
 * List batches, ACTIVE-FIRST then newest-made: the current generation of a name is always item
 * one, older generations follow visibly finished. This ordering is what lets "get me the taco
 * chicken" answer all three cases (current exists / only old ones / nothing) in a single call.
 */
export async function listBatches(
  opts: Page & { q?: string; status?: "active" | "finished" | "all" } = {}
): Promise<Paged<BatchView>> {
  const { limit = 50, offset = 0, q, status = "all" } = opts;
  const conds = [live(macroBatch.deletedAt)];
  if (q) conds.push(ilike(macroBatch.name, `%${q}%`));
  if (status === "active") conds.push(isNull(macroBatch.finishedOn));
  if (status === "finished") conds.push(isNotNull(macroBatch.finishedOn));
  const where = and(...conds);
  const items = await db
    .select()
    .from(macroBatch)
    .where(where)
    .orderBy(sql`(${macroBatch.finishedOn} is null) desc`, desc(macroBatch.madeOn), desc(macroBatch.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(macroBatch).where(where);
  return { items: items.map(batchToView), count: c };
}

/** The detail view: the row plus derived consumption. `remainingGrams` is ADVISORY (only logged
 *  draws deplete it) and null unless the batch recorded initialGrams. */
export async function getBatchById(id: string): Promise<BatchDetailView | null> {
  const row = await getBatchRowById(id);
  if (!row) return null;
  const [agg] = await db
    .select({ consumed: sum(macroEntry.quantityGrams), draws: count() })
    .from(macroEntry)
    .where(and(eq(macroEntry.batchId, id), live(macroEntry.deletedAt)));
  const consumedGrams = Number(agg?.consumed ?? 0);
  return {
    ...batchToView(row),
    consumedGrams,
    remainingGrams: row.initialGrams == null ? null : row.initialGrams - consumedGrams,
    drawCount: agg?.draws ?? 0,
  };
}

/** Patch a batch — including finish ({ finishedOn }) and unfinish ({ finishedOn: null }). The
 *  finishedOn>=madeOn cross-check runs against the EFFECTIVE (patched-over-stored) values. */
export async function patchBatch(id: string, patch: BatchPatch): Promise<BatchView | null> {
  const existing = await getBatchRowById(id);
  if (!existing) return null;
  if (Object.keys(patch).length === 0) return batchToView(existing);
  const madeOn = patch.madeOn ?? existing.madeOn;
  const finishedOn = patch.finishedOn === undefined ? existing.finishedOn : patch.finishedOn;
  if (finishedOn != null && finishedOn < madeOn) {
    throw new MacroDomainError("batch_dates_invalid", `finishedOn (${finishedOn}) must be on or after madeOn (${madeOn})`);
  }
  const [row] = await db
    .update(macroBatch)
    .set(patch)
    .where(and(eq(macroBatch.id, id), live(macroBatch.deletedAt)))
    .returning();
  return row ? batchToView(row) : null;
}

export async function softDeleteBatch(id: string): Promise<boolean> {
  const [row] = await db
    .update(macroBatch)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroBatch.id, id), live(macroBatch.deletedAt)))
    .returning({ id: macroBatch.id });
  return !!row;
}

/** Hard delete — physically removes the row. Auth layer gates this to the primary key. */
export async function hardDeleteBatch(id: string): Promise<boolean> {
  const [row] = await db.delete(macroBatch).where(eq(macroBatch.id, id)).returning({ id: macroBatch.id });
  return !!row;
}

// ────────────────────────────────────────────────────────── Entries ──────────

type MacroColumns = Record<(typeof NUTRITION_KEYS)[number], number | null>;

/**
 * Derive absolute snapshot macros: caller-supplied values win; the rest come from the linked
 * food's — or batch's — per-100g values × quantity. Snapshotting freezes the entry as an
 * immutable fact. A batch draw ALWAYS passes the draw guard here, even with all macros supplied.
 */
async function snapshotMacros(input: EntryCreate): Promise<MacroColumns> {
  const needsDerivation = NUTRITION_KEYS.some((k) => input[k] == null);
  let per100: MacroColumns | null = null;
  if (input.batchId != null) {
    const batch = await assertDrawableBatch(input.batchId, input.consumedOn);
    if (needsDerivation) per100 = batch;
  } else if (input.foodId != null && needsDerivation) {
    per100 = await getFoodById(input.foodId);
  }

  const factor = input.quantityGrams / 100;
  const out = {} as MacroColumns;
  for (const k of NUTRITION_KEYS) {
    const supplied = input[k];
    if (supplied != null) out[k] = supplied;
    else if (per100 && per100[k] != null) out[k] = (per100[k] as number) * factor;
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
      batchId: input.batchId ?? null,
      quantityGrams: input.quantityGrams,
      confidence: input.confidence,
      note: input.note ?? null,
      ...macros,
    })
    .returning();
  await bump("health");
  return row;
}

/**
 * Log several entries ATOMICALLY. Every input is snapshotted, then all rows go in via a SINGLE
 * INSERT — so the batch is all-or-nothing: any row that violates a constraint fails the whole
 * statement and writes nothing (there is no partial commit). Returns the created entries in the
 * unified `EntryView` shape, in INPUT ORDER, so a composite meal can be logged and read in one call.
 */
export async function createEntries(inputs: EntryCreate[]): Promise<EntryView[]> {
  const values = await Promise.all(
    inputs.map(async (input) => ({
      name: input.name ?? null,
      consumedOn: input.consumedOn,
      foodId: input.foodId ?? null,
      batchId: input.batchId ?? null,
      quantityGrams: input.quantityGrams,
      confidence: input.confidence,
      note: input.note ?? null,
      ...(await snapshotMacros(input)),
    }))
  );
  // One statement → atomic. RETURNING preserves the VALUES order, giving us input-ordered ids.
  const inserted = await db.insert(macroEntry).values(values).returning({ id: macroEntry.id });
  const ids = inserted.map((r) => r.id);
  // Re-read through the shared projection so the caller gets resolved `name` + the full macro set.
  const rows = (await db
    .select(entrySelection)
    .from(macroEntry)
    .leftJoin(macroFood, eq(macroEntry.foodId, macroFood.id))
    .leftJoin(macroBatch, eq(macroEntry.batchId, macroBatch.id))
    .where(inArray(macroEntry.id, ids))) as EntryView[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  await bump("health");
  return ids.map((id) => byId.get(id)!);
}

export async function getEntryById(id: string): Promise<MacroEntry | null> {
  const [row] = await db
    .select()
    .from(macroEntry)
    .where(and(eq(macroEntry.id, id), live(macroEntry.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function listEntries(opts: Page & { on?: string } = {}): Promise<Paged<EntryView>> {
  const { limit = 50, offset = 0, on } = opts;
  const where = on
    ? and(live(macroEntry.deletedAt), eq(macroEntry.consumedOn, on))
    : live(macroEntry.deletedAt);
  const items = await db
    .select(entrySelection)
    .from(macroEntry)
    .leftJoin(macroFood, eq(macroEntry.foodId, macroFood.id))
    .leftJoin(macroBatch, eq(macroEntry.batchId, macroBatch.id))
    .where(where)
    .orderBy(desc(macroEntry.consumedOn), asc(macroEntry.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(macroEntry).where(where);
  return { items: items as EntryView[], count: c };
}

export async function patchEntry(id: string, patch: EntryPatch): Promise<MacroEntry | null> {
  if (Object.keys(patch).length === 0) return getEntryById(id);
  // Re-validate batch rules against the EFFECTIVE (patched-over-stored) linkage/date: the
  // food-XOR-batch invariant (friendlier than the DB check's 500), and the draw guard when the
  // patch touches the batch linkage or the date.
  if (patch.foodId !== undefined || patch.batchId !== undefined || patch.consumedOn !== undefined) {
    const existing = await getEntryById(id);
    if (!existing) return null;
    const foodId = patch.foodId === undefined ? existing.foodId : patch.foodId;
    const batchId = patch.batchId === undefined ? existing.batchId : patch.batchId;
    if (foodId != null && batchId != null) {
      throw new MacroDomainError("food_xor_batch", "an entry links to a food or a batch, never both");
    }
    if (batchId != null && (patch.batchId !== undefined || patch.consumedOn !== undefined)) {
      await assertDrawableBatch(batchId, patch.consumedOn ?? existing.consumedOn);
    }
  }
  const [row] = await db
    .update(macroEntry)
    .set(patch)
    .where(and(eq(macroEntry.id, id), live(macroEntry.deletedAt)))
    .returning();
  if (row) await bump("health");
  return row ?? null;
}

export async function softDeleteEntry(id: string): Promise<boolean> {
  const [row] = await db
    .update(macroEntry)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroEntry.id, id), live(macroEntry.deletedAt)))
    .returning({ id: macroEntry.id });
  if (row) await bump("health");
  return !!row;
}

export async function hardDeleteEntry(id: string): Promise<boolean> {
  const [row] = await db.delete(macroEntry).where(eq(macroEntry.id, id)).returning({ id: macroEntry.id });
  if (row) await bump("health");
  return !!row;
}

// ────────────────────────────────────────────────────────── Day tags ─────────

/** Upsert a day's kind. One live tag per day: if a live tag exists we update it, else insert. */
export async function setDayTag(input: DayTagCreate): Promise<MacroDayTag> {
  const existing = await getLiveDayTag(input.day);
  const [row] = existing
    ? await db
        .update(macroDayTag)
        .set({ kind: input.kind })
        .where(eq(macroDayTag.id, existing.id))
        .returning()
    : await db.insert(macroDayTag).values(input).returning();
  await bump("health");
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
  if (row) await bump("health");
  return row ?? null;
}

export async function softDeleteDayTag(day: string): Promise<boolean> {
  const [row] = await db
    .update(macroDayTag)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroDayTag.day, day), live(macroDayTag.deletedAt)))
    .returning({ id: macroDayTag.id });
  if (row) await bump("health");
  return !!row;
}

export async function hardDeleteDayTag(id: string): Promise<boolean> {
  const [row] = await db.delete(macroDayTag).where(eq(macroDayTag.id, id)).returning({ id: macroDayTag.id });
  if (row) await bump("health");
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
  await bump("health"); // a target change moves "remaining" on the health screen
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
  if (row) await bump("health");
  return row ?? null;
}

export async function softDeleteTargetProfile(id: string): Promise<boolean> {
  const [row] = await db
    .update(macroTargetProfile)
    .set({ deletedAt: new Date() })
    .where(and(eq(macroTargetProfile.id, id), live(macroTargetProfile.deletedAt)))
    .returning({ id: macroTargetProfile.id });
  if (row) await bump("health");
  return !!row;
}

export async function hardDeleteTargetProfile(id: string): Promise<boolean> {
  const [row] = await db
    .delete(macroTargetProfile)
    .where(eq(macroTargetProfile.id, id))
    .returning({ id: macroTargetProfile.id });
  if (row) await bump("health");
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

export type DayRollup = {
  day: { date: string; kind: "training" | "rest" | "unspecified" };
  totals: MacroSet;
  estimation: { estimatedFraction: number; entryCount: number; estimatedCount: number };
  targets: Partial<Record<"training" | "rest", MacroSet>>;
  // The day's entries use the SAME shape `GET /entries` returns (`EntryView`).
  entries: EntryView[];
};

/**
 * The day-rollup (HANDOFF-CODE "the one thing the recipes template can't guide"). Sums the
 * day's live entries, computes the estimated-calorie fraction, resolves the day's kind, and
 * resolves target(s) — returning BOTH training and rest when the day is unspecified.
 */
export async function getDayRollup(date: string): Promise<DayRollup> {
  const rows = (await db
    .select(entrySelection)
    .from(macroEntry)
    .leftJoin(macroFood, eq(macroEntry.foodId, macroFood.id))
    .leftJoin(macroBatch, eq(macroEntry.batchId, macroBatch.id))
    .where(and(eq(macroEntry.consumedOn, date), live(macroEntry.deletedAt)))
    .orderBy(asc(macroEntry.createdAt))) as EntryView[];

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

// ──────────────────────────────────────────────────────── Range ──────────────

/** One day in a range view: its four-macro totals (zeroed when nothing is logged), its kind, and
 *  the target(s) that apply — mirroring `getDayRollup` (BOTH targets on an unspecified day). */
export type RangeDay = {
  date: string;
  kind: "training" | "rest" | "unspecified";
  totals: MacroSet;
  targets: Partial<Record<"training" | "rest", MacroSet>>;
};

const zeroTotals = (): MacroSet => ({ calories: 0, proteinContent: 0, fatContent: 0, carbohydrateContent: 0 });

/**
 * Per-day totals across the inclusive span [start, end]. Returns ONE row per calendar day —
 * days with no entries come back zeroed, never missing, so "didn't eat" is distinguishable from
 * "not logged" only by the caller's own records, never by a gap in the series. Totals stay the four
 * targeted macros (this is a range view over the existing rollup, not a schema change).
 */
export async function getRange(start: string, end: string): Promise<RangeDay[]> {
  // Grouped four-macro sums — only days that HAVE entries appear here.
  const grouped = await db
    .select({
      day: macroEntry.consumedOn,
      calories: sum(macroEntry.calories),
      proteinContent: sum(macroEntry.proteinContent),
      fatContent: sum(macroEntry.fatContent),
      carbohydrateContent: sum(macroEntry.carbohydrateContent),
    })
    .from(macroEntry)
    .where(and(gte(macroEntry.consumedOn, start), lte(macroEntry.consumedOn, end), live(macroEntry.deletedAt)))
    .groupBy(macroEntry.consumedOn);

  const totalsByDay = new Map<string, MacroSet>();
  for (const g of grouped) {
    totalsByDay.set(g.day, {
      calories: Number(g.calories ?? 0),
      proteinContent: Number(g.proteinContent ?? 0),
      fatContent: Number(g.fatContent ?? 0),
      carbohydrateContent: Number(g.carbohydrateContent ?? 0),
    });
  }

  const kinds = await dayKindsBetween(start, end);

  // Resolve targets in-memory: fetch every live profile once (latest effectiveFrom wins per kind),
  // rather than firing resolveTarget per day.
  const profiles = await db
    .select()
    .from(macroTargetProfile)
    .where(live(macroTargetProfile.deletedAt))
    .orderBy(desc(macroTargetProfile.effectiveFrom));
  const targetFor = (kind: string, date: string): MacroSet | null => {
    const p = profiles.find((pr) => pr.kind === kind && pr.effectiveFrom <= date);
    return p ? { calories: p.calories, proteinContent: p.proteinContent, fatContent: p.fatContent, carbohydrateContent: p.carbohydrateContent } : null;
  };

  return dateRange(start, end).map((date) => {
    const kind = (kinds[date] as "training" | "rest" | undefined) ?? "unspecified";
    const targets: Partial<Record<"training" | "rest", MacroSet>> = {};
    for (const k of kind === "unspecified" ? (["training", "rest"] as const) : ([kind] as const)) {
      const t = targetFor(k, date);
      if (t) targets[k] = t;
    }
    return { date, kind, totals: totalsByDay.get(date) ?? zeroTotals(), targets };
  });
}
