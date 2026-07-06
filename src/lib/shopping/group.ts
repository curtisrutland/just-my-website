import type { CategoryGroup, ShoppingItemView } from "./types";

/** Case-insensitive string compare (grouping and sorting are both case-insensitive). */
const ci = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

/** The case-insensitive key two categories share ("Produce" and " produce " → "produce"). */
const key = (category: string) => category.trim().toLowerCase();

/**
 * Group items by category **case-insensitively** — "Produce" and "produce" merge into one group.
 * Shared by the repo (server) and the board (client) so both group identically. The group's display
 * label is the most common casing among its items (ties → the casing that sorts first), so a stray
 * mis-cased entry doesn't rename the group. Groups and items-within are case-insensitive alphabetical.
 * Order-independent: the same items in any order produce the same result (server ⇄ client agree).
 */
export function groupByCategory(items: ShoppingItemView[]): CategoryGroup[] {
  const byKey = new Map<string, ShoppingItemView[]>();
  for (const it of items) {
    const list = byKey.get(key(it.category)) ?? [];
    list.push(it);
    byKey.set(key(it.category), list);
  }
  return [...byKey.values()]
    .map((list) => ({
      category: representativeLabel(list),
      items: list.slice().sort((a, b) => ci(a.text, b.text)),
    }))
    .sort((a, b) => ci(a.category, b.category));
}

/** The distinct categories for the add/edit suggestions — deduped case-insensitively, each shown in
 *  its representative casing, sorted. */
export function distinctCategories(items: ShoppingItemView[]): string[] {
  const byKey = new Map<string, ShoppingItemView[]>();
  for (const it of items) {
    const list = byKey.get(key(it.category)) ?? [];
    list.push(it);
    byKey.set(key(it.category), list);
  }
  return [...byKey.values()].map(representativeLabel).sort(ci);
}

/** Most common casing among these items' categories; ties broken by case-sensitive order (stable). */
function representativeLabel(items: ShoppingItemView[]): string {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}
