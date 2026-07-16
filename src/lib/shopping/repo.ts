import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { shoppingItem, type ShoppingItem } from "@/lib/db/schema";
import { bump } from "@/lib/panel/version";
import { groupByCategory } from "./group";
import type { ShoppingCreate, ShoppingPatch } from "./schema";
import type { ShoppingItemView, ShoppingList, ShoppingStatus } from "./types";

/**
 * Shopping module — repository. The only place `shopping_item` is touched. Reads exclude
 * soft-deleted. Grouping (category → item) and the two-section split are derived here; the table
 * stays a single flat list.
 *
 * Every mutation calls `bump("shopping")` AFTER it commits so the panel's version poll notices
 * (panel-contract §4.2). Fire-and-forget; never fails a write. New write paths MUST bump too.
 */

const live = isNull(shoppingItem.deletedAt);
const RECENT_DAYS = 7;

/** Row → the lean, serialization-safe shape the UI consumes (audit columns dropped). */
function toView(row: ShoppingItem): ShoppingItemView {
  return {
    id: row.id,
    category: row.category,
    text: row.text,
    status: row.status as ShoppingStatus,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
  };
}

// -- CRUD ---------------------------------------------------------------------

/** Add an item — always starts `needed` (status is not a create input). */
export async function addItem(input: ShoppingCreate): Promise<ShoppingItem> {
  const [row] = await db
    .insert(shoppingItem)
    .values({ category: input.category, text: input.text })
    .returning();
  await bump("shopping");
  return row;
}

export async function getItemById(id: string): Promise<ShoppingItem | null> {
  const [row] = await db
    .select()
    .from(shoppingItem)
    .where(and(eq(shoppingItem.id, id), live))
    .limit(1);
  return row ?? null;
}

/** Flat paginated list (API completeness; the UI uses `getList` instead). Newest first. */
export async function listItems(
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: ShoppingItem[]; count: number }> {
  const { limit = 50, offset = 0 } = opts;
  const items = await db
    .select()
    .from(shoppingItem)
    .where(live)
    .orderBy(desc(shoppingItem.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ c }] = await db.select({ c: count() }).from(shoppingItem).where(live);
  return { items, count: c };
}

/**
 * Edit an item's `category`/`text`, and/or transition its `status`. A status change derives
 * `checkedAt`: → `bought` stamps now, → `needed` clears it. Fields absent from the patch are left
 * untouched (so editing text on a bought item keeps its `checkedAt`).
 */
export async function patchItem(id: string, patch: ShoppingPatch): Promise<ShoppingItem | null> {
  const set: Partial<typeof shoppingItem.$inferInsert> = {};
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.text !== undefined) set.text = patch.text;
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.checkedAt = patch.status === "bought" ? new Date() : null;
  }
  if (Object.keys(set).length === 0) return getItemById(id);
  const [row] = await db
    .update(shoppingItem)
    .set(set)
    .where(and(eq(shoppingItem.id, id), live))
    .returning();
  if (row) await bump("shopping");
  return row ?? null;
}

export async function softDeleteItem(id: string): Promise<boolean> {
  const [row] = await db
    .update(shoppingItem)
    .set({ deletedAt: new Date() })
    .where(and(eq(shoppingItem.id, id), live))
    .returning({ id: shoppingItem.id });
  if (row) await bump("shopping");
  return !!row;
}

export async function hardDeleteItem(id: string): Promise<boolean> {
  const [row] = await db
    .delete(shoppingItem)
    .where(eq(shoppingItem.id, id))
    .returning({ id: shoppingItem.id });
  if (row) await bump("shopping");
  return !!row;
}

// -- The two-section view -----------------------------------------------------

/**
 * The list as the UI renders it: `active` (needed items grouped by category, case-insensitive
 * alphabetical, items alphabetical within a group) + `recentlyBought` (bought within the window,
 * newest-checked first) + `activeCount` for the header readout. Bought items older than the window
 * simply fall out of the read — they stay in the DB (no purge).
 */
export async function getList(opts: { boughtWithinDays?: number } = {}): Promise<ShoppingList> {
  const windowDays = opts.boughtWithinDays ?? RECENT_DAYS;

  const activeRows = await db
    .select()
    .from(shoppingItem)
    .where(and(live, eq(shoppingItem.status, "needed")));

  const active = groupByCategory(activeRows.map(toView));

  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const boughtRows = await db
    .select()
    .from(shoppingItem)
    .where(and(live, eq(shoppingItem.status, "bought"), gte(shoppingItem.checkedAt, cutoff)))
    .orderBy(desc(shoppingItem.checkedAt));

  return {
    active,
    recentlyBought: boughtRows.map(toView),
    activeCount: activeRows.length,
  };
}
