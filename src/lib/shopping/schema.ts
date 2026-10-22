import * as z from "zod";
import { auditView, isoInstant } from "@/lib/http/view-schemas";

/**
 * Shopping module — Zod schemas. Single source of truth for validation; both write surfaces (web
 * server actions, token API) call these. One grouping level (a freeform `category` string → item);
 * no quantity field (the `text` line carries it, e.g. "2 dozen eggs"); no normalization.
 */

export const shoppingCreateSchema = z
  .object({
    category: z.string().trim().min(1),
    text: z.string().trim().min(1),
  })
  .strict();

// PATCH: any create field, plus the check/un-check status transition. `status` is not a create
// input — items start `needed` server-side; the repo derives `checkedAt` from a status change.
export const shoppingPatchSchema = shoppingCreateSchema
  .partial()
  .extend({ status: z.enum(["needed", "bought"]).optional() })
  .strict();

export type ShoppingCreate = z.infer<typeof shoppingCreateSchema>;
export type ShoppingPatch = z.infer<typeof shoppingPatchSchema>;

// --- Response views (the JSON the routes send; OpenAPI + the contract test read these) ---

export const shoppingStatusSchema = z.enum(["needed", "bought"]);

/** A list item as `/list` and the UI consume it — the row without audit columns. */
export const shoppingItemViewSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  text: z.string(),
  status: shoppingStatusSchema,
  checkedAt: isoInstant.nullable(),
});

/** One category's items, for the grouped active list. */
export const categoryGroupSchema = z.object({ category: z.string(), items: z.array(shoppingItemViewSchema) });

/** The two-section list read returned by `getList` (see docs/shopping-model.md). */
export const shoppingListSchema = z.object({
  active: z.array(categoryGroupSchema), // grouped by category, case-insensitive alphabetical
  recentlyBought: z.array(shoppingItemViewSchema), // status=bought, checkedAt within the window, newest first
  activeCount: z.number().int(), // total `needed` items — feeds the header's ON THE LIST readout
});

/**
 * What POST/PATCH (and the per-item GETs) return today: the full row, audit columns included — a
 * different shape from the list's `ShoppingItemView` (#40).
 */
export const shoppingItemRowSchema = shoppingItemViewSchema.extend(auditView);
