import { and, gte, lte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { liftingGoal } from "@/lib/db/schema";
import { getGoalOn, listGoals, patchGoal, setGoal, softDeleteGoal } from "./repo";

/** Integration test against live Neon, same shape as the weight repo test. Far-PAST sentinel dates
 *  (1901) so these rows can never be the answer to a real `getGoalOn()` (any real goal is 2026+, and
 *  resolution takes the LATEST effectiveFrom <= the date asked for). Cleans up after; wipes only the
 *  1901 range, never real data.
 *
 *  Every `setGoal` here passes an explicit `effectiveFrom` — the default is TODAY, which would write
 *  a real goal into the live journal. */

async function wipe() {
  await db.delete(liftingGoal).where(and(gte(liftingGoal.effectiveFrom, "1901-01-01"), lte(liftingGoal.effectiveFrom, "1901-12-31")));
}

beforeAll(wipe);
afterAll(wipe);

describe("goal resolution: latest effectiveFrom on/before the date", () => {
  it("resolves the goal in force, ignores future-dated goals, and returns null before the first", async () => {
    await setGoal({ statement: "block one — build the pull", effectiveFrom: "1901-06-01" });
    await setGoal({ statement: "block two — strength, lower volume", effectiveFrom: "1901-08-01" });

    // Before any goal existed: nothing in force.
    expect(await getGoalOn("1901-05-31")).toBeNull();

    // On the boundary and mid-block, the goal in force is block one.
    expect((await getGoalOn("1901-06-01"))?.statement).toBe("block one — build the pull");
    expect((await getGoalOn("1901-07-15"))?.statement).toBe("block one — build the pull");

    // Once block two takes effect it supersedes — but block one is still readable at its own date,
    // which is the whole reason goals are dated rather than a single overwritten row.
    expect((await getGoalOn("1901-08-01"))?.statement).toBe("block two — strength, lower volume");
    expect((await getGoalOn("1901-07-31"))?.statement).toBe("block one — build the pull");
  });

  it("upserts on the date — restating the same day rewords, it does not stack a second goal", async () => {
    await setGoal({ statement: "first wording", effectiveFrom: "1901-09-01" });
    const second = await setGoal({ statement: "sharper wording", effectiveFrom: "1901-09-01" });

    expect((await getGoalOn("1901-09-01"))?.statement).toBe("sharper wording");
    const onThatDay = (await listGoals({ limit: 100 })).items.filter((g) => g.effectiveFrom === "1901-09-01");
    expect(onThatDay).toHaveLength(1);
    expect(onThatDay[0].id).toBe(second.id);
  });

  it("patches in place and soft-deletes back to the previous goal", async () => {
    const a = await setGoal({ statement: "keep", effectiveFrom: "1901-10-01" });
    const b = await setGoal({ statement: "supersede", effectiveFrom: "1901-11-01" });

    const patched = await patchGoal(b.id, { statement: "supersede, reworded" });
    expect(patched?.statement).toBe("supersede, reworded");
    expect(patched?.id).toBe(b.id);
    expect((await getGoalOn("1901-11-15"))?.statement).toBe("supersede, reworded");

    // Soft-deleting a goal falls back to the one it superseded, not to null.
    expect(await softDeleteGoal(b.id)).toBe(true);
    expect((await getGoalOn("1901-11-15"))?.id).toBe(a.id);
    expect(await softDeleteGoal(b.id)).toBe(false); // already gone
  });

  it("lists history newest first", async () => {
    await setGoal({ statement: "older", effectiveFrom: "1901-02-01" });
    await setGoal({ statement: "newer", effectiveFrom: "1901-03-01" });
    const sentinels = (await listGoals({ limit: 100 })).items.filter((g) => g.effectiveFrom.startsWith("1901-0"));
    const dates = sentinels.map((g) => g.effectiveFrom);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
