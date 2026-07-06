/** Shopping domain + list-contract types. Consumed by both the repo/lib layer and the UI — hence
 *  they live in `lib/shopping`, never in `components`. */

export type ShoppingStatus = "needed" | "bought";

/** A list item as the UI consumes it — a projection of the row (audit columns dropped, `checkedAt`
 *  serialized to an ISO string so it crosses the server→client boundary cleanly). */
export type ShoppingItemView = {
  id: string;
  category: string;
  text: string;
  status: ShoppingStatus;
  checkedAt: string | null;
};

/** One category's items, for the grouped active list. */
export type CategoryGroup = {
  category: string;
  items: ShoppingItemView[];
};

/** The two-section list read returned by `getList` (see docs/shopping-model.md). */
export type ShoppingList = {
  active: CategoryGroup[]; // grouped by category, case-insensitive alphabetical
  recentlyBought: ShoppingItemView[]; // status=bought, checkedAt within the window, newest first
  activeCount: number; // total `needed` items — feeds the header's ON THE LIST readout
};
