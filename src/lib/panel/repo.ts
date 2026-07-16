import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { panelState, type PanelState } from "@/lib/db/schema";
import type { NormalizedRecipe } from "./types";
import { bump } from "./version";

/**
 * Panel module — repository. The ONLY place `panel_state` is touched. Singleton row (id = 1); the
 * empty state is "no row / active_recipe null", never a deleted row.
 */

export async function getPanelState(): Promise<PanelState | null> {
  const [row] = await db.select().from(panelState).where(eq(panelState.id, 1)).limit(1);
  return row ?? null;
}

/**
 * Send-to-panel: replace the active recipe (upsert the singleton). Stores the RAW payload as-is plus
 * the normalized view; snapshot semantics (what was sent is what's cooked). Bumps the recipe version.
 * Returns `setAt` for the endpoint's `sentAt`.
 */
export async function setPanelRecipe(input: {
  raw: unknown;
  norm: NormalizedRecipe;
  sourceUrl: string | null;
}): Promise<Date> {
  const setAt = new Date();
  const values = {
    activeRecipe: input.raw,
    activeRecipeNorm: input.norm,
    sourceUrl: input.sourceUrl,
    setAt,
  };
  await db
    .insert(panelState)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: panelState.id, set: values });
  await bump("recipe");
  return setAt;
}
