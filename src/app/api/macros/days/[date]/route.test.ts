import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as getWeightEntries } from "@/app/api/weight/entries/route";
import { POST as postVitals } from "@/app/api/vitals/route";
import { DELETE as deleteEntry, PATCH as patchEntry } from "../../entries/[id]/route";
import { POST as postEntry } from "../../entries/route";
import { GET as getRange } from "../../range/route";
import { GET } from "./route";

/**
 * The display token's scope, checked against the REAL route handlers (not just the helper): it can
 * read the day rollup and nothing else — no other macros read, no macros write, no hard DELETE, no
 * other module, not the publisher's routes. Every rejection happens in the auth layer, before any
 * body parse or DB touch. The one 200 case is an integration read against Neon (like the repo tests).
 */
const display = (process.env.JMW_DISPLAY_TOKEN ||= "jmw_test_display_token");
const auth = { authorization: `Bearer ${display}` };
const url = (path: string) => `https://justmy.website${path}`;
const ENTRY_ID = "00000000-0000-0000-0000-000000000000";
const entryCtx = { params: Promise.resolve({ id: ENTRY_ID }) };
const dayCtx = (date: string) => ({ params: Promise.resolve({ date }) });

describe("GET /api/macros/days/{date} — accepts the display token", () => {
  it("passes auth: a bad date is a 400 validation error, not a 401", async () => {
    const res = await GET(new NextRequest(url("/api/macros/days/not-a-date"), { headers: auth }), dayCtx("not-a-date"));
    expect(res.status).toBe(400);
  });

  it("returns the day rollup (200)", async () => {
    const res = await GET(new NextRequest(url("/api/macros/days/2026-09-09"), { headers: auth }), dayCtx("2026-09-09"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("totals");
    expect(body).toHaveProperty("target");
  });

  it("still rejects a missing token (401)", async () => {
    const res = await GET(new NextRequest(url("/api/macros/days/2026-09-09")), dayCtx("2026-09-09"));
    expect(res.status).toBe(401);
  });
});

describe("the display token is rejected everywhere else (401)", () => {
  it("another macros read: GET /api/macros/range", async () => {
    const res = await getRange(new NextRequest(url("/api/macros/range?start=2026-09-01&end=2026-09-09"), { headers: auth }));
    expect(res.status).toBe(401);
  });

  it("a macros write: POST /api/macros/entries", async () => {
    const res = await postEntry(
      new NextRequest(url("/api/macros/entries"), { method: "POST", headers: auth, body: "{}" })
    );
    expect(res.status).toBe(401);
  });

  it("a macros write: PATCH /api/macros/entries/{id}", async () => {
    const res = await patchEntry(
      new NextRequest(url(`/api/macros/entries/${ENTRY_ID}`), { method: "PATCH", headers: auth, body: "{}" }),
      entryCtx
    );
    expect(res.status).toBe(401);
  });

  it("soft DELETE and hard DELETE on /api/macros/entries/{id}", async () => {
    const soft = await deleteEntry(
      new NextRequest(url(`/api/macros/entries/${ENTRY_ID}`), { method: "DELETE", headers: auth }),
      entryCtx
    );
    const hard = await deleteEntry(
      new NextRequest(url(`/api/macros/entries/${ENTRY_ID}?hard=true`), { method: "DELETE", headers: auth }),
      entryCtx
    );
    expect(soft.status).toBe(401);
    expect(hard.status).toBe(401);
  });

  it("another module's read: GET /api/weight/entries", async () => {
    const res = await getWeightEntries(new NextRequest(url("/api/weight/entries"), { headers: auth }));
    expect(res.status).toBe(401);
  });

  it("the publisher's route: POST /api/vitals", async () => {
    const res = await postVitals(new NextRequest(url("/api/vitals"), { method: "POST", headers: auth, body: "{}" }));
    expect(res.status).toBe(401);
  });
});
