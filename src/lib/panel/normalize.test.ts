import { describe, expect, it } from "vitest";
import { normalizeInstructions, normalizeRecipe, validateSendPayload } from "./normalize";

describe("normalizeInstructions — every schema.org shape flattens to {heading,text}", () => {
  it("bare string → one step per non-empty line", () => {
    expect(normalizeInstructions("Do the thing.")).toEqual([{ heading: null, text: "Do the thing." }]);
    expect(normalizeInstructions("Line one.\nLine two.")).toEqual([
      { heading: null, text: "Line one." },
      { heading: null, text: "Line two." },
    ]);
  });

  it("array of strings", () => {
    expect(normalizeInstructions(["A.", "B."])).toEqual([
      { heading: null, text: "A." },
      { heading: null, text: "B." },
    ]);
  });

  it("array of HowToStep, with and without a name heading", () => {
    expect(
      normalizeInstructions([
        { "@type": "HowToStep", name: "Sear", text: "Sear it." },
        { "@type": "HowToStep", text: "Rest it." },
      ])
    ).toEqual([
      { heading: "Sear", text: "Sear it." },
      { heading: null, text: "Rest it." },
    ]);
  });

  it("HowToSection with nested steps — section name is the heading when a step has none", () => {
    expect(
      normalizeInstructions([
        {
          "@type": "HowToSection",
          name: "Prep",
          itemListElement: [
            { "@type": "HowToStep", text: "Chop." },
            { "@type": "HowToStep", name: "Mix", text: "Combine." },
          ],
        },
      ])
    ).toEqual([
      { heading: "Prep", text: "Chop." },
      { heading: "Mix", text: "Combine." },
    ]);
  });

  it("mixed array (string + HowToStep)", () => {
    expect(
      normalizeInstructions(["Plain step.", { "@type": "HowToStep", name: "Named", text: "Named step." }])
    ).toEqual([
      { heading: null, text: "Plain step." },
      { heading: "Named", text: "Named step." },
    ]);
  });

  it("empty / structureless → []", () => {
    expect(normalizeInstructions(null)).toEqual([]);
    expect(normalizeInstructions([])).toEqual([]);
    expect(normalizeInstructions([{ "@type": "HowToStep" }])).toEqual([]); // no text/name → dropped
  });
});

describe("normalizeRecipe", () => {
  it("coerces yield/nutrition, carries notes, drops empty ingredients, nulls missing optionals", () => {
    const norm = normalizeRecipe({
      "@type": "Recipe",
      name: "Bites",
      recipeYield: 12,
      totalTime: "PT1H20M",
      recipeIngredient: ["6 eggs", "   ", "salt"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Cook." }],
      nutrition: { calories: 148, proteinContent: "12 g", fatContent: 9 },
      notes: "Keeps 5 days.",
      image: "http://x/img.jpg", // unknown-to-panel; ignored by norm (rides along in the raw payload)
    });
    expect(norm).toEqual({
      name: "Bites",
      description: null,
      recipeYield: "12",
      totalTime: "PT1H20M",
      ingredients: ["6 eggs", "salt"],
      steps: [{ heading: null, text: "Cook." }],
      notes: "Keeps 5 days.",
      nutrition: { calories: 148, proteinContent: 12, fatContent: 9, carbohydrateContent: null },
    });
  });

  it("string yield + missing nutrition → null", () => {
    const norm = normalizeRecipe({ name: "X", recipeYield: "6 bites", recipeIngredient: ["a"] });
    expect(norm.recipeYield).toBe("6 bites");
    expect(norm.nutrition).toBeNull();
    expect(norm.steps).toEqual([]);
  });
});

describe("validateSendPayload (minimum accept criteria, unknown fields preserved)", () => {
  const good = { "@type": "Recipe", name: "X", recipeInstructions: [{ "@type": "HowToStep", text: "Go." }] };

  it("accepts a valid recipe and extracts sourceUrl", () => {
    const r = validateSendPayload({ recipe: good, sourceUrl: "https://justmy.recipes/r/x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sourceUrl).toBe("https://justmy.recipes/r/x");
  });

  it("accepts a bare object without @type (documented leniency)", () => {
    expect(validateSendPayload({ recipe: { name: "X", recipeIngredient: ["a"] } }).ok).toBe(true);
  });

  it("rejects @type that isn't Recipe", () => {
    const r = validateSendPayload({ recipe: { "@type": "HowTo", name: "X", recipeIngredient: ["a"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/@type/);
  });

  it("rejects a missing / empty name", () => {
    const r = validateSendPayload({ recipe: { "@type": "Recipe", recipeIngredient: ["a"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/name/);
  });

  it("rejects when neither ingredients nor instructions are present", () => {
    const r = validateSendPayload({ recipe: { name: "X" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/recipeIngredient|recipeInstructions/);
  });

  it("rejects a non-object body or a missing recipe", () => {
    expect(validateSendPayload(null).ok).toBe(false);
    expect(validateSendPayload({ sourceUrl: "x" }).ok).toBe(false);
  });

  it("sourceUrl is optional → null", () => {
    const r = validateSendPayload({ recipe: good });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sourceUrl).toBeNull();
  });
});
