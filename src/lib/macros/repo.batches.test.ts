import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { macroBatch, macroEntry } from "@/lib/db/schema";
import {
  createBatch,
  createEntry,
  getBatchById,
  listBatches,
  MacroDomainError,
  patchBatch,
  patchEntry,
} from "./repo";

/**
 * Integration test against the live Neon dev database, following repo.rollup.test.ts: sentinel
 * far-future dates (no collision with real data), hard-delete of everything created afterward.
 * Exercises the batch lifecycle end-to-end: register → draw (snapshot) → derived consumption →
 * finish → draw guard (incl. the late-log exception) → active-first listing.
 */

const MADE = "2999-05-01";
const DRAW_DAY = "2999-05-02";
const AFTER_FINISH = "2999-05-03";
const NAME = "repo-test taco chicken";
const createdBatchIds: string[] = [];

async function cleanup() {
  for (const day of [MADE, DRAW_DAY, AFTER_FINISH]) {
    await db.delete(macroEntry).where(eq(macroEntry.consumedOn, day));
  }
  for (const id of createdBatchIds) await db.delete(macroBatch).where(eq(macroBatch.id, id));
}

afterAll(cleanup);

const per100g = { calories: 150, proteinContent: 20, fatContent: 5, carbohydrateContent: 5 };

describe("batch lifecycle", () => {
  it("registers, draws with snapshot, derives consumption, finishes, and guards", async () => {
    const { batch, activeNameMatches } = await createBatch({
      name: NAME,
      madeOn: MADE,
      initialGrams: 1000,
      ...per100g,
    });
    createdBatchIds.push(batch.id);
    expect(batch.status).toBe("active");
    expect(activeNameMatches).toEqual([]);

    // Draw 200g with no macros supplied → snapshot from the batch's per-100g.
    const entry = await createEntry({
      consumedOn: DRAW_DAY,
      batchId: batch.id,
      quantityGrams: 200,
      confidence: "measured",
    });
    expect(entry.calories).toBeCloseTo(300, 6);
    expect(entry.proteinContent).toBeCloseTo(40, 6);

    // Derived consumption on the detail view.
    const detail = await getBatchById(batch.id);
    expect(detail).toMatchObject({ consumedGrams: 200, remainingGrams: 800, drawCount: 1 });

    // Finish; a later-dated draw is rejected, a backdated one (≤ finishedOn) is allowed.
    const finished = await patchBatch(batch.id, { finishedOn: DRAW_DAY });
    expect(finished?.status).toBe("finished");
    await expect(
      createEntry({ consumedOn: AFTER_FINISH, batchId: batch.id, quantityGrams: 100, confidence: "measured" })
    ).rejects.toThrow(MacroDomainError);
    const lateLog = await createEntry({
      consumedOn: MADE,
      batchId: batch.id,
      quantityGrams: 100,
      confidence: "measured",
    });
    expect(lateLog.calories).toBeCloseTo(150, 6);
  });

  it("rejects finishing before madeOn (effective values)", async () => {
    const { batch } = await createBatch({ name: `${NAME} v2`, madeOn: DRAW_DAY, ...per100g });
    createdBatchIds.push(batch.id);
    await expect(patchBatch(batch.id, { finishedOn: MADE })).rejects.toThrow(MacroDomainError);
  });

  it("surfaces an active same-name batch on register, and lists active-first", async () => {
    // v2 (previous test) is still active with a same-prefix name; register the SAME name as the
    // finished batch → the finished one must NOT be surfaced, only active ones with that exact name.
    const { batch: gen2, activeNameMatches } = await createBatch({ name: NAME, madeOn: AFTER_FINISH, ...per100g });
    createdBatchIds.push(gen2.id);
    expect(activeNameMatches.map((b) => b.id)).toEqual([]); // gen1 is finished → not a match

    const { batch: gen3, activeNameMatches: matches3 } = await createBatch({
      name: NAME,
      madeOn: AFTER_FINISH,
      ...per100g,
    });
    createdBatchIds.push(gen3.id);
    expect(matches3.map((b) => b.id)).toEqual([gen2.id]); // now gen2 IS active with the same name

    const listed = await listBatches({ q: NAME });
    const statuses = listed.items.map((b) => b.status);
    // Active-first: no "active" may appear after a "finished".
    expect(statuses.indexOf("finished")).toBeGreaterThan(statuses.lastIndexOf("active"));
    expect(listed.items[0].madeOn).toBe(AFTER_FINISH); // newest-made active first
  });

  it("re-validates the guard on entry patch (batch linkage or date changes)", async () => {
    const finishedId = createdBatchIds[0]; // gen1: finished on DRAW_DAY
    const entry = await createEntry({ consumedOn: DRAW_DAY, quantityGrams: 50, confidence: "measured" });
    // Linking an unlinked entry to a finished batch works when the date is ≤ finishedOn…
    const linked = await patchEntry(entry.id, { batchId: finishedId });
    expect(linked?.batchId).toBe(finishedId);
    // …but moving that entry past the finish date is a contradiction.
    await expect(patchEntry(entry.id, { consumedOn: AFTER_FINISH })).rejects.toThrow(MacroDomainError);
    // And food+batch on one entry is rejected before the DB check turns it into a 500.
    await expect(
      patchEntry(entry.id, { foodId: "7e57ab1e-0000-4000-8000-000000000001" })
    ).rejects.toThrow(MacroDomainError);
  });
});
