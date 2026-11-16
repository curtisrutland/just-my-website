import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as bikes, POST as createBike } from "@/app/api/garage/bikes/route";
import { GET as tags, POST as createTag } from "@/app/api/garage/rides/route";
import { POST as attribute } from "./route";

/**
 * The publisher token's third route (docs/garage-model.md, CONVENTIONS §2): the daemon may apply the
 * bike rules to rides it just uploaded, and do nothing else in the garage. Each call here stops at
 * auth or validation, before the database.
 */
const publisher = process.env.JMW_PUBLISHER_TOKEN!;
const req = (method: string, body?: unknown) =>
  new NextRequest("https://x/api/garage/rides/attribute", {
    method,
    headers: { authorization: `Bearer ${publisher}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("publisher token on the garage", () => {
  it("is accepted by POST /api/garage/rides/attribute (an empty batch fails validation, not auth)", async () => {
    const res = await attribute(req("POST", { rides: [] }));
    expect(res.status).toBe(400);
  });

  it("is rejected by every other garage route: no reads, no bikes, no hand tags", async () => {
    expect((await bikes(req("GET"))).status).toBe(401);
    expect((await createBike(req("POST", {}))).status).toBe(401);
    expect((await tags(req("GET"))).status).toBe(401);
    expect((await createTag(req("POST", {}))).status).toBe(401);
  });

  it("an unknown token is still rejected by the attribute route", async () => {
    const bad = new NextRequest("https://x/api/garage/rides/attribute", {
      method: "POST",
      headers: { authorization: "Bearer nope", "content-type": "application/json" },
      body: JSON.stringify({ rides: [] }),
    });
    expect((await attribute(bad)).status).toBe(401);
  });
});
