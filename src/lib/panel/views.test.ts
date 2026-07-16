import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { todayISO } from "@/lib/date";
import type { MacroSet } from "@/lib/macros/schema";
import { db } from "@/lib/db";
import { panelState } from "@/lib/db/schema";
import { addItem, hardDeleteItem, patchItem } from "@/lib/shopping/repo";
import { chooseTarget, panelHealth, panelRecipe, panelShopping, trendEnum } from "./views";

const T = (calories: number): MacroSet => ({ calories, proteinContent: 160, fatContent: 75, carbohydrateContent: 220 });

describe("trendEnum (deadband = display precision)", () => {
  it("maps the signed rate to a glyph the number can't contradict", () => {
    expect(trendEnum(null)).toBeNull();
    expect(trendEnum(0)).toBe("flat");
    expect(trendEnum(-0.6)).toBe("down");
    expect(trendEnum(0.3)).toBe("up");
    expect(trendEnum(-0.1)).toBe("down");
  });
});

describe("chooseTarget (unspecified → lower-calorie profile)", () => {
  it("picks the day's kind when specified", () => {
    expect(chooseTarget("training", { training: T(2800), rest: T(2200) })).toMatchObject({ calories: 2800 });
    expect(chooseTarget("rest", { training: T(2800), rest: T(2200) })).toMatchObject({ calories: 2200 });
  });
  it("picks the lower-calorie profile, wholesale, when unspecified", () => {
    expect(chooseTarget("unspecified", { training: T(2800), rest: T(2200) })).toMatchObject({ calories: 2200 });
    expect(chooseTarget("unspecified", { training: T(2800) })).toMatchObject({ calories: 2800 });
    expect(chooseTarget("unspecified", {})).toBeNull();
  });
});

describe("panelShopping", () => {
  const created: string[] = [];
  const CAT = "zzz-panel-test";
  afterAll(async () => {
    for (const id of created) await hardDeleteItem(id);
  });

  it("flattens needed + recently-bought with a checked flag", async () => {
    const a = await addItem({ category: CAT, text: "panel-test-A" });
    const b = await addItem({ category: CAT, text: "panel-test-B" });
    created.push(a.id, b.id);
    await patchItem(b.id, { status: "bought" }); // → recently bought → checked

    const view = await panelShopping();
    const mine = view.items.filter((i) => i.category === CAT);
    expect(mine).toHaveLength(2);
    expect(mine.find((i) => i.name === "panel-test-A")).toMatchObject({ checked: false });
    expect(mine.find((i) => i.name === "panel-test-B")).toMatchObject({ checked: true });
    expect(view.counts.total).toBe(view.items.length);
    expect(view.counts.unchecked).toBeLessThanOrEqual(view.counts.total);
  });
});

describe("panelRecipe", () => {
  afterAll(async () => {
    await db.delete(panelState).where(eq(panelState.id, 1));
  });

  it("returns the empty state when nothing is sent", async () => {
    await db.delete(panelState).where(eq(panelState.id, 1));
    expect(await panelRecipe()).toEqual({ recipe: null, sentAt: null, sourceUrl: null });
  });

  it("returns the normalized recipe when set", async () => {
    const norm = {
      name: "Test Bites",
      description: null,
      recipeYield: null,
      totalTime: null,
      ingredients: ["6 eggs"],
      steps: [{ heading: null, text: "Cook." }],
      notes: null,
      nutrition: null,
    };
    await db.insert(panelState).values({ id: 1, activeRecipeNorm: norm, sourceUrl: "https://x/r", setAt: new Date() });
    const r = await panelRecipe();
    expect(r.recipe).toMatchObject({ name: "Test Bites", ingredients: ["6 eggs"] });
    expect(r.sourceUrl).toBe("https://x/r");
    expect(typeof r.sentAt).toBe("string");
  });
});

describe("panelHealth (shape smoke vs live data)", () => {
  it("returns today's date, numeric macro quads, and the weight block", async () => {
    const h = await panelHealth();
    expect(h.date).toBe(todayISO());
    expect([null, "training", "rest"]).toContain(h.dayType);
    for (const k of ["kcal", "protein", "fat", "carb"] as const) {
      expect(typeof h.macros.consumed[k]).toBe("number");
      expect(typeof h.macros.target[k]).toBe("number");
      expect(h.macros.remaining[k]).toBe(h.macros.target[k] - h.macros.consumed[k]); // panel does no math
    }
    expect(h.weight.windowDays).toBe(30);
    expect(Array.isArray(h.weight.series)).toBe(true);
    expect([null, "down", "flat", "up"]).toContain(h.weight.trend);
  });
});
