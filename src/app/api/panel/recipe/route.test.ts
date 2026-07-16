import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deviceToken, panelState } from "@/lib/db/schema";
import { createDeviceToken } from "@/lib/panel/tokens";
import { GET, POST } from "./route";

/**
 * Integration: the send-to-panel endpoint end-to-end (auth → validate → normalize → store → read).
 * All panel_state mutations live in THIS file so they run sequentially (vitest parallelizes across
 * files, and panel_state is a singleton — a cross-file race would be flaky).
 */
const TOKENS = ["test-recipe-svc", "test-recipe-read"];

const post = (token: string, body: unknown) =>
  POST(
    new Request("https://x/api/panel/recipe", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
const get = (token: string) =>
  GET(new Request("https://x/api/panel/recipe", { headers: { authorization: `Bearer ${token}` } }) as never);

afterAll(async () => {
  await db.delete(panelState).where(eq(panelState.id, 1));
  await db.delete(deviceToken).where(inArray(deviceToken.name, TOKENS));
});

const RECIPE = {
  "@type": "Recipe",
  name: "Cottage Cheese Egg Bites",
  description: "Silky sous-vide egg bites.",
  recipeYield: "12 bites",
  totalTime: "PT1H20M",
  recipeIngredient: ["6 large eggs", "115 g cottage cheese"],
  recipeInstructions: [
    { "@type": "HowToStep", name: "Preheat the water bath", text: "Set the circulator to 172F." },
    { "@type": "HowToStep", text: "Blend and pour." },
  ],
  nutrition: { calories: 148, proteinContent: 12, fatContent: 9, carbohydrateContent: 3 },
  notes: "Keeps 5 days.",
  image: "https://x/photo.jpg", // rides along in the raw payload; ignored by the normalized view
};

describe("POST /api/panel/recipe (send-to-panel)", () => {
  it("accepts a valid recipe from the service token and stores the normalized view", async () => {
    const { raw: svc } = await createDeviceToken({ name: "test-recipe-svc", scopes: ["panel:write:recipe"] });
    const { raw: read } = await createDeviceToken({ name: "test-recipe-read", scopes: ["panel:read"] });

    const res = await post(svc, { recipe: RECIPE, sourceUrl: "https://justmy.recipes/r/egg-bites" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.sentAt).toBe("string");

    // Read it back through GET: normalized shape, flat steps with headings, notes carried, source kept.
    const got = await (await get(read)).json();
    expect(got.sourceUrl).toBe("https://justmy.recipes/r/egg-bites");
    expect(got.recipe).toMatchObject({
      name: "Cottage Cheese Egg Bites",
      recipeYield: "12 bites",
      ingredients: ["6 large eggs", "115 g cottage cheese"],
      steps: [
        { heading: "Preheat the water bath", text: "Set the circulator to 172F." },
        { heading: null, text: "Blend and pour." },
      ],
      notes: "Keeps 5 days.",
      nutrition: { calories: 148, proteinContent: 12 },
    });

    // Raw payload is stored unmodified — the unknown `image` field rides along.
    const [row] = await db.select().from(panelState).where(eq(panelState.id, 1));
    expect((row.activeRecipe as { image?: string }).image).toBe("https://x/photo.jpg");
  });

  it("rejects a malformed payload with 400 + errors (validated on receive)", async () => {
    const { raw: svc } = await createDeviceToken({ name: "test-recipe-svc", scopes: ["panel:write:recipe"] });
    const res = await post(svc, { recipe: { "@type": "Recipe", recipeIngredient: [] } }); // no name, no content
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid JSON with 400 + errors", async () => {
    const { raw: svc } = await createDeviceToken({ name: "test-recipe-svc", scopes: ["panel:write:recipe"] });
    const res = await POST(
      new Request("https://x/api/panel/recipe", {
        method: "POST",
        headers: { authorization: `Bearer ${svc}`, "content-type": "application/json" },
        body: "{not json",
      }) as never
    );
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  it("rejects a token without panel:write:recipe (401)", async () => {
    const { raw: read } = await createDeviceToken({ name: "test-recipe-read", scopes: ["panel:read"] });
    const res = await post(read, { recipe: RECIPE });
    expect(res.status).toBe(401);
  });
});
