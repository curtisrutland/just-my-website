import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shoppingItem } from "@/lib/db/schema";
import { addItem, getItemById, getList, patchItem, softDeleteItem } from "./repo";
import type { CategoryGroup } from "./types";

/** Integration test against live Neon. Test rows are namespaced with a `__test__` category prefix;
 *  cleanup hard-deletes only those, never touching real items. */

const T = "__test__";
const findTest = (list: CategoryGroup[]) => list.filter((g) => g.category.startsWith(T));

async function wipe() {
  await db.delete(shoppingItem).where(like(shoppingItem.category, `${T}%`));
}

beforeAll(wipe);
afterAll(wipe);

describe("getList: grouping, sorting, activeCount", () => {
  it("starts items needed, groups by category (case-insensitive alpha), sorts items within", async () => {
    // Insert out of order and with mixed case to prove sorting is case-insensitive.
    await addItem({ category: `${T}bravo`, text: "zucchini" });
    await addItem({ category: `${T}bravo`, text: "apples" });
    await addItem({ category: `${T}Alpha`, text: "milk" });

    const { active, activeCount } = await getList();
    const groups = findTest(active);

    expect(groups.map((g) => g.category)).toEqual([`${T}Alpha`, `${T}bravo`]); // Alpha before bravo (ci)
    expect(groups[1].items.map((i) => i.text)).toEqual(["apples", "zucchini"]); // ci within group
    // activeCount counts ALL needed items (whole table), so it's at least our three test rows.
    expect(activeCount).toBeGreaterThanOrEqual(3);
  });

  it("groups categories case-insensitively (mixed casing → one group)", async () => {
    // Same category, three casings — must collapse to a single group.
    await addItem({ category: `${T}Zed`, text: "one" });
    await addItem({ category: `${T}zed`, text: "two" });
    await addItem({ category: `${T}ZED`, text: "three" });

    const { active } = await getList();
    const zed = active.filter((g) => g.category.toLowerCase() === `${T}zed`.toLowerCase());
    expect(zed).toHaveLength(1); // one group, not three
    expect(zed[0].items.map((i) => i.text)).toEqual(["one", "three", "two"]); // all three items, ci-sorted
  });
});

describe("check / uncheck lifecycle", () => {
  it("check → bought + checkedAt; leaves active, enters recentlyBought; uncheck reverses it", async () => {
    const item = await addItem({ category: `${T}Dairy`, text: "oat milk" });
    expect(item.status).toBe("needed");
    expect(item.checkedAt).toBeNull();

    // Check it off.
    const checked = await patchItem(item.id, { status: "bought" });
    expect(checked?.status).toBe("bought");
    expect(checked?.checkedAt).toBeInstanceOf(Date);

    let list = await getList();
    expect(findTest(list.active).some((g) => g.items.some((i) => i.text === "oat milk"))).toBe(false);
    expect(list.recentlyBought.some((i) => i.id === item.id)).toBe(true);

    // Un-check (undo).
    const restored = await patchItem(item.id, { status: "needed" });
    expect(restored?.status).toBe("needed");
    expect(restored?.checkedAt).toBeNull();

    list = await getList();
    expect(findTest(list.active).some((g) => g.items.some((i) => i.text === "oat milk"))).toBe(true);
    expect(list.recentlyBought.some((i) => i.id === item.id)).toBe(false);
  });
});

describe("recentlyBought window", () => {
  it("excludes bought items older than the window; editing text keeps checkedAt", async () => {
    // Directly seed a bought row checked 10 days ago (older than the 7-day window).
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const [stale] = await db
      .insert(shoppingItem)
      .values({ category: `${T}Pantry`, text: "stale coffee", status: "bought", checkedAt: old })
      .returning();

    const list = await getList();
    expect(list.recentlyBought.some((i) => i.id === stale.id)).toBe(false); // outside window
    // Widening the window pulls it in.
    const wide = await getList({ boughtWithinDays: 30 });
    expect(wide.recentlyBought.some((i) => i.id === stale.id)).toBe(true);

    // Editing text on a bought item must not disturb checkedAt.
    const edited = await patchItem(stale.id, { text: "stale coffee (edited)" });
    expect(edited?.text).toBe("stale coffee (edited)");
    expect(edited?.checkedAt?.getTime()).toBe(old.getTime());
  });
});

describe("soft-delete", () => {
  it("removes an item from all reads", async () => {
    const item = await addItem({ category: `${T}Household`, text: "dish soap" });
    expect(await softDeleteItem(item.id)).toBe(true);
    expect(await getItemById(item.id)).toBeNull();

    const list = await getList();
    expect(findTest(list.active).some((g) => g.items.some((i) => i.id === item.id))).toBe(false);
  });
});
