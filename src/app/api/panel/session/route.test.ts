import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deviceToken } from "@/lib/db/schema";
import { createDeviceToken } from "@/lib/panel/tokens";
import { GET } from "./route";

/** Integration: the one-time kiosk session route. Sets the panel_token cookie for a valid device
 *  token, rejects a missing/bad/underscoped one. Tokens cleaned up after. */
const TOKENS = ["test-session"];
const get = (qs: string) => GET(new Request(`https://justmy.website/api/panel/session${qs}`));

afterAll(async () => {
  await db.delete(deviceToken).where(inArray(deviceToken.name, TOKENS));
});

describe("GET /api/panel/session", () => {
  it("sets an httpOnly panel_token cookie and redirects for a valid panel:read token", async () => {
    const { raw } = await createDeviceToken({ name: "test-session", scopes: ["panel:read", "panel:write:shopping"] });
    const res = await get(`?token=${encodeURIComponent(raw)}`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/panel/health");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`panel_token=${raw}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("400 when no token is supplied", async () => {
    expect((await get("")).status).toBe(400);
  });

  it("401 for an unknown token", async () => {
    expect((await get("?token=jmw_nope")).status).toBe(401);
  });

  it("401 for a token without panel:read (e.g. the recipes service token)", async () => {
    const { raw } = await createDeviceToken({ name: "test-session", scopes: ["panel:write:recipe"] });
    expect((await get(`?token=${encodeURIComponent(raw)}`)).status).toBe(401);
  });
});
