import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deviceToken } from "@/lib/db/schema";
import { requirePanelAuth } from "./auth";
import { createDeviceToken, findLiveTokenByRaw, hashToken } from "./tokens";

/**
 * Integration test against live Neon. Every token minted here uses a recognizable name so the
 * afterAll wipe removes only this suite's rows and never a real credential.
 */
const TEST_NAMES = ["test-panel", "test-recipes", "test-revoked", "test-noscope"];

const bearer = (raw: string) => new Request("https://x/api/panel/x", { headers: { authorization: `Bearer ${raw}` } });
const cookied = (raw: string) => new Request("https://x/api/panel/x", { headers: { cookie: `panel_token=${raw}` } });

afterAll(async () => {
  await db.delete(deviceToken).where(inArray(deviceToken.name, TEST_NAMES));
});

describe("device token storage", () => {
  it("hashes deterministically and never stores the raw token", async () => {
    const { raw, id } = await createDeviceToken({ name: "test-panel", scopes: ["panel:read"] });
    expect(raw).toMatch(/^jmw_/);
    const [row] = await db.select().from(deviceToken).where(inArray(deviceToken.name, ["test-panel"]));
    expect(row.id).toBe(id);
    expect(row.tokenHash).toBe(hashToken(raw));
    expect(row.tokenHash).not.toContain(raw); // the raw value is not recoverable from what's stored
  });

  it("resolves a live token by its raw value and rejects unknown ones", async () => {
    const { raw } = await createDeviceToken({ name: "test-recipes", scopes: ["panel:write:recipe"] });
    expect(await findLiveTokenByRaw(raw)).toMatchObject({ name: "test-recipes", scopes: ["panel:write:recipe"] });
    expect(await findLiveTokenByRaw("jmw_not-a-real-token")).toBeNull();
  });
});

describe("requirePanelAuth — device token path", () => {
  it("accepts a token that holds the required scope", async () => {
    const { raw, id } = await createDeviceToken({ name: "test-panel", scopes: ["panel:read", "panel:write:shopping"] });
    const res = await requirePanelAuth(bearer(raw), "panel:write:shopping");
    expect(res).toMatchObject({ ok: true, via: "token", tokenId: id });
  });

  it("accepts a device token via the panel_token cookie (the Pi kiosk path)", async () => {
    const { raw, id } = await createDeviceToken({ name: "test-panel", scopes: ["panel:read"] });
    const res = await requirePanelAuth(cookied(raw), "panel:read");
    expect(res).toMatchObject({ ok: true, via: "token", tokenId: id });
  });

  it("prefers the Authorization header over the cookie", async () => {
    const { raw } = await createDeviceToken({ name: "test-panel", scopes: ["panel:read"] });
    const req = new Request("https://x/api/panel/x", {
      headers: { authorization: `Bearer ${raw}`, cookie: "panel_token=jmw_bogus" },
    });
    expect((await requirePanelAuth(req, "panel:read")).ok).toBe(true);
  });

  it("rejects a token that lacks the required scope (401)", async () => {
    const { raw } = await createDeviceToken({ name: "test-noscope", scopes: ["panel:read"] });
    const res = await requirePanelAuth(bearer(raw), "panel:write:recipe");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("rejects an unknown bearer token (401)", async () => {
    const res = await requirePanelAuth(bearer("jmw_bogus"), "panel:read");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("rejects a revoked token (401)", async () => {
    const { raw, id } = await createDeviceToken({ name: "test-revoked", scopes: ["panel:read"] });
    await db.update(deviceToken).set({ revokedAt: new Date() }).where(inArray(deviceToken.id, [id]));
    expect(await findLiveTokenByRaw(raw)).toBeNull();
    const res = await requirePanelAuth(bearer(raw), "panel:read");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("denies a missing bearer with no session (no anonymous access)", async () => {
    // No Authorization header. In the test runtime there's no clerkMiddleware context, so the session
    // branch either returns no userId (→ 401) or throws for the missing middleware; both mean "no
    // anonymous access". The real browser session-accept path is verified in-browser at step 6.
    let denied = false;
    try {
      const res = await requirePanelAuth(new Request("https://x/api/panel/x"), "panel:read");
      denied = !res.ok;
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
  });
});
