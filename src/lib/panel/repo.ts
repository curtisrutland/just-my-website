import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { panelState, type PanelState } from "@/lib/db/schema";

/**
 * Panel module — repository. The ONLY place `panel_state` is touched. Singleton row (id = 1); the
 * empty state is "no row / active_recipe null", never a deleted row. The write side (send-to-panel)
 * lands in build step 5.
 */

export async function getPanelState(): Promise<PanelState | null> {
  const [row] = await db.select().from(panelState).where(eq(panelState.id, 1)).limit(1);
  return row ?? null;
}
