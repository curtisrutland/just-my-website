import { and, gte, inArray, lte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as versionGET } from "@/app/api/panel/version/route";
import { db } from "@/lib/db";
import { deviceToken, weightEntry } from "@/lib/db/schema";
import { setWeight } from "@/lib/weight/repo";
import { kv } from "./kv";
import { createDeviceToken } from "./tokens";
import { bump, PANEL_SECTIONS, readVersions } from "./version";

/** Integration test: real Upstash KV + real Neon. Uses a 1903 sentinel date distinct from the
 *  weight-repo suite's 1901 range so parallel test files don't race on the unique measured_on.
 *  Version keys are shared state these tests intentionally move forward. */
const client = kv();
const SENTINEL = "1903-03-03";

async function wipe() {
  await db.delete(weightEntry).where(and(gte(weightEntry.measuredOn, "1903-01-01"), lte(weightEntry.measuredOn, "1903-12-31")));
  await db.delete(deviceToken).where(inArray(deviceToken.name, ["test-version"]));
}

beforeAll(wipe);
afterAll(wipe);

describe("version bump + read", () => {
  it("readVersions returns all three sections as numbers", async () => {
    const v = await readVersions();
    for (const s of PANEL_SECTIONS) expect(typeof v[s]).toBe("number");
  });

  it("bump moves a section's version strictly forward", async () => {
    await client!.set("panel:v:health", 1); // known-low baseline
    await bump("health");
    const v = await readVersions();
    expect(v.health).toBeGreaterThan(1);
    expect(v.health).toBeGreaterThan(1_700_000_000); // a real unix-seconds stamp
  });

  it("a repo write bumps its section (weight → health)", async () => {
    await client!.set("panel:v:health", 1);
    await setWeight({ measuredOn: SENTINEL, weight: 200 }); // routes through weight repo → bump
    const v = await readVersions();
    expect(v.health).toBeGreaterThan(1);
  });
});

describe("GET /api/panel/version", () => {
  it("authenticates panel:read and returns the three version integers, no-store", async () => {
    const { raw } = await createDeviceToken({ name: "test-version", scopes: ["panel:read"] });
    const res = await versionGET(
      new Request("https://x/api/panel/version", { headers: { authorization: `Bearer ${raw}` } }) as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    for (const s of PANEL_SECTIONS) expect(typeof body[s]).toBe("number");
  });

  it("rejects a token without panel:read (401)", async () => {
    const { raw } = await createDeviceToken({ name: "test-version", scopes: ["panel:write:shopping"] });
    const res = await versionGET(
      new Request("https://x/api/panel/version", { headers: { authorization: `Bearer ${raw}` } }) as never
    );
    expect(res.status).toBe(401);
  });
});
