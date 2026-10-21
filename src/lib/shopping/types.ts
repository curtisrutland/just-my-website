import type * as z from "zod";
import type { categoryGroupSchema, shoppingItemViewSchema, shoppingListSchema, shoppingStatusSchema } from "./schema";

/** Shopping domain + list-contract types. Consumed by both the repo/lib layer and the UI — hence
 *  they live in `lib/shopping`, never in `components`. Inferred from the view schemas in
 *  `schema.ts`, so the repo's builders are type-checked against the published contract. */

export type ShoppingStatus = z.infer<typeof shoppingStatusSchema>;

/** A list item as the UI consumes it — a projection of the row (audit columns dropped, `checkedAt`
 *  serialized to an ISO string so it crosses the server→client boundary cleanly). */
export type ShoppingItemView = z.infer<typeof shoppingItemViewSchema>;

/** One category's items, for the grouped active list. */
export type CategoryGroup = z.infer<typeof categoryGroupSchema>;

/** The two-section list read returned by `getList` (see docs/shopping-model.md). */
export type ShoppingList = z.infer<typeof shoppingListSchema>;
