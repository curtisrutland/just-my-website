import type { ShoppingItemView, ShoppingList } from "@/lib/shopping/types";

/** Mock list for the dev `/preview` harness, mirroring the design prototype's seed. Built as a
 *  function (not a const) so `recentlyBought` timestamps are relative to *now* at render time —
 *  computed once on the server and serialized into the client props, so they stay inside the 7-day
 *  window without hydration drift. */
export function buildMockShoppingList(): ShoppingList {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const need = (id: string, category: string, text: string): ShoppingItemView => ({ id, category, text, status: "needed", checkedAt: null });
  const bought = (id: string, category: string, text: string, n: number): ShoppingItemView => ({ id, category, text, status: "bought", checkedAt: daysAgo(n) });

  const active = [
    { category: "Bakery", items: [need("m1", "Bakery", "sourdough loaf")] },
    { category: "Dairy", items: [need("m2", "Dairy", "block of cheddar"), need("m3", "Dairy", "large tub of greek yogurt")] },
    { category: "Frozen", items: [need("m4", "Frozen", "2 bags peas"), need("m5", "Frozen", "family pack chicken thighs")] },
    { category: "Household", items: [need("m6", "Household", "dish soap"), need("m7", "Household", "kitchen roll")] },
    { category: "Pantry", items: [need("m8", "Pantry", "3 cans chickpeas"), need("m9", "Pantry", "jar of peanut butter"), need("m10", "Pantry", "olive oil")] },
    { category: "Produce", items: [need("m11", "Produce", "2 dozen eggs"), need("m12", "Produce", "a big thing of spinach"), need("m13", "Produce", "bananas")] },
  ];

  return {
    active,
    recentlyBought: [
      bought("m14", "Dairy", "oat milk", 1),
      bought("m15", "Pantry", "coffee", 2),
      bought("m16", "Household", "paper towels", 3),
    ],
    activeCount: active.reduce((n, g) => n + g.items.length, 0),
  };
}
