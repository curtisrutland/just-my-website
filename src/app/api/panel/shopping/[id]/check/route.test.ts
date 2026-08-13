import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deviceToken } from "@/lib/db/schema";
import { createDeviceToken } from "@/lib/panel/tokens";
import { addItem, getItemById, hardDeleteItem } from "@/lib/shopping/repo";
import { POST } from "./route";

/** Integration: the panel's check/uncheck endpoint. Isolated temp item; tokens cleaned up after.
 *  (Check-off is the panel's only write path; the day-type endpoint it once shared this note with
 *  was removed when day-type was deprecated.) */
const TOKENS = ["test-check"];
const created: string[] = [];

const call = (id: string, token: string | null, body: unknown) =>
  POST(
    new Request(`https://x/api/panel/shopping/${id}/check`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) }
  );

afterAll(async () => {
  for (const id of created) await hardDeleteItem(id);
  await db.delete(deviceToken).where(inArray(deviceToken.name, TOKENS));
});

describe("POST /api/panel/shopping/:id/check", () => {
  it("checks and unchecks an item with panel:write:shopping", async () => {
    const { raw } = await createDeviceToken({ name: "test-check", scopes: ["panel:write:shopping"] });
    const item = await addItem({ category: "zzz-check", text: "check-me" });
    created.push(item.id);

    expect((await call(item.id, raw, { checked: true })).status).toBe(200);
    expect((await getItemById(item.id))?.status).toBe("bought");

    expect((await call(item.id, raw, { checked: false })).status).toBe(200);
    expect((await getItemById(item.id))?.status).toBe("needed");
  });

  it("rejects unknown id (404), wrong scope (401), and a non-boolean body (400)", async () => {
    const { raw } = await createDeviceToken({ name: "test-check", scopes: ["panel:write:shopping"] });
    const { raw: read } = await createDeviceToken({ name: "test-check", scopes: ["panel:read"] });
    const item = await addItem({ category: "zzz-check", text: "check-me-2" });
    created.push(item.id);

    expect((await call("00000000-0000-0000-0000-000000000000", raw, { checked: true })).status).toBe(404);
    expect((await call(item.id, read, { checked: true })).status).toBe(401);
    expect((await call(item.id, raw, { checked: "yes" })).status).toBe(400);
  });
});
