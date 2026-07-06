import * as z from "zod";

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
