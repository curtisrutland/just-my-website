import { eq, like } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deviceToken } from "@/lib/db/schema";
import { getEntryByDay, hardDeleteEntry } from "@/lib/weight/repo";
import { addItem, getItemById, hardDeleteItem } from "@/lib/shopping/repo";
import { createDeviceToken, listDeviceTokens, revokeDeviceToken } from "./device-tokens";
import { mintedTokenSchema } from "./pairing";
import { PHONE_SCOPES, WEIGH_IN_SCOPES } from "./scopes";
import { requireBearer, requireDevice, requirePrimary, requireScope } from "./tokens";

import { GET as macrosDay } from "@/app/api/macros/days/[date]/route";
import { GET as macrosRange } from "@/app/api/macros/range/route";
import { POST as macrosEntryCreate } from "@/app/api/macros/entries/route";
import { GET as weightRollup } from "@/app/api/weight/rollup/route";
import { GET as weightList, POST as weightCreate } from "@/app/api/weight/entries/route";
import { GET as weightDay } from "@/app/api/weight/days/[date]/route";
import { POST as weighInToken } from "@/app/api/weight/weigh-in-token/route";
import { DELETE as weightDelete } from "@/app/api/weight/entries/[id]/route";
import { GET as liftingSessions } from "@/app/api/lifting/sessions/route";
import { GET as liftingLift } from "@/app/api/lifting/lifts/[templateId]/route";
import { GET as liftingSession, PATCH as liftingSessionPatch } from "@/app/api/lifting/sessions/[id]/route";
import { GET as rides } from "@/app/api/rides/route";
import { GET as ridesWeekly } from "@/app/api/rides/weekly/route";
import { GET as ride, PATCH as ridePatch } from "@/app/api/rides/[id]/route";
import { GET as rideFit } from "@/app/api/rides/[id]/fit/route";
import { GET as vitalsList } from "@/app/api/vitals/route";
import { GET as vitalsSummary } from "@/app/api/vitals/summary/route";
import { DELETE as vitalsDelete, GET as vitalsDay } from "@/app/api/vitals/[date]/route";
import { GET as shoppingList } from "@/app/api/shopping/list/route";
import { GET as shoppingItems, POST as shoppingCreate } from "@/app/api/shopping/items/route";
import { DELETE as shoppingDelete, PATCH as shoppingPatch } from "@/app/api/shopping/items/[id]/route";

/**
 * Integration: device tokens on module routes (CONVENTIONS §2, `docs/ios-app.md` §3.5) against live
 * Neon. Every token minted here uses a `test-scope*` name (a child's name starts with its parent's)
 * so the afterAll wipe removes only this suite's rows; the weight write uses a 1990 date and the shopping item a `zzz-scope` category, both
 * hard-deleted after.
 */
const TOKEN_PREFIX = "test-scope";
const WEIGHT_DAY = "1990-01-01";
const shoppingIds: string[] = [];

const primary = process.env.JMW_API_KEY!;
const agent = process.env.JMW_AGENT_TOKEN!;

afterAll(async () => {
  const w = await getEntryByDay(WEIGHT_DAY);
  if (w) await hardDeleteEntry(w.id);
  for (const id of shoppingIds) await hardDeleteItem(id);
  await db.delete(deviceToken).where(like(deviceToken.name, `${TOKEN_PREFIX}%`));
});

const req = (token: string | null, path = "/api/x", init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`https://x${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

const phone = () => createDeviceToken({ name: "test-scope", scopes: PHONE_SCOPES });

describe("requireScope", () => {
  it("passes the env tokens for any scope, exactly as requireBearer does", async () => {
    expect(await requireScope(req(primary), "weight:read")).toMatchObject({ ok: true, kind: "primary" });
    expect(await requireScope(req(agent), "shopping:write")).toMatchObject({ ok: true, kind: "agent" });
  });

  it("rejects a missing or unknown token (401)", async () => {
    const missing = await requireScope(req(null), "weight:read");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.response.status).toBe(401);
    expect((await requireScope(req("jmw_not-a-real-token"), "weight:read")).ok).toBe(false);
  });

  it("accepts a live device token that holds the scope", async () => {
    const { raw, id } = await phone();
    expect(await requireScope(req(raw), "vitals:read")).toMatchObject({ ok: true, kind: "device", tokenId: id });
  });

  it("rejects a device token that lacks the scope (401)", async () => {
    const { raw } = await createDeviceToken({ name: "test-scope-narrow", scopes: ["weight:read"] });
    const r = await requireScope(req(raw), "weight:write");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("rejects a panel token on module routes (panel scopes are not module scopes)", async () => {
    const { raw } = await createDeviceToken({ name: "test-scope-panel", scopes: ["panel:read", "panel:write:shopping"] });
    expect((await requireScope(req(raw), "shopping:read")).ok).toBe(false);
  });

  it("rejects a revoked token, and revoking twice is a no-op", async () => {
    const { raw, id } = await createDeviceToken({ name: "test-scope-revoked", scopes: PHONE_SCOPES });
    expect((await requireScope(req(raw), "weight:read")).ok).toBe(true);
    expect(await revokeDeviceToken(id)).toBe(true);
    expect((await requireScope(req(raw), "weight:read")).ok).toBe(false);
    expect(await revokeDeviceToken(id)).toBe(false);
  });

  it("rejects a soft-deleted token", async () => {
    const { raw, id } = await createDeviceToken({ name: "test-scope-deleted", scopes: PHONE_SCOPES });
    await db.update(deviceToken).set({ deletedAt: new Date() }).where(eq(deviceToken.id, id));
    expect((await requireScope(req(raw), "weight:read")).ok).toBe(false);
  });

  it("stamps last_seen_at on success", async () => {
    const { raw, id } = await phone();
    await requireScope(req(raw), "weight:read");
    let seen: Date | null = null;
    for (let i = 0; i < 20 && !seen; i++) {
      await new Promise((r) => setTimeout(r, 100));
      [{ lastSeenAt: seen }] = await db.select({ lastSeenAt: deviceToken.lastSeenAt }).from(deviceToken).where(eq(deviceToken.id, id));
    }
    expect(seen).toBeInstanceOf(Date);
  });

  it("never lets a device token pass requireBearer or requirePrimary", async () => {
    const { raw } = await phone();
    expect(requireBearer(req(raw)).ok).toBe(false);
    expect(requirePrimary(req(raw)).ok).toBe(false);
  });
});

describe("the iOS allowlist — a phone token on module routes", () => {
  it("passes auth on every allowlisted read (never 401)", async () => {
    const { raw } = await phone();
    const nil = "00000000-0000-0000-0000-000000000000";
    const reads: [string, Promise<Response>][] = [
      ["macros day", macrosDay(req(raw), ctx({ date: "2026-10-01" }))],
      ["weight rollup", weightRollup(req(raw, "/api/weight/rollup"))],
      ["weight list", weightList(req(raw, "/api/weight/entries"))],
      ["weight day", weightDay(req(raw), ctx({ date: "2026-10-01" }))],
      ["lifting sessions", liftingSessions(req(raw, "/api/lifting/sessions"))],
      ["rides", rides(req(raw, "/api/rides"))],
      ["rides weekly", ridesWeekly(req(raw, "/api/rides/weekly"))],
      ["vitals list", vitalsList(req(raw, "/api/vitals"))],
      ["vitals summary", vitalsSummary(req(raw, "/api/vitals/summary"))],
      ["shopping list", shoppingList(req(raw, "/api/shopping/list"))],
      // Detail reads by an id that doesn't exist: a 404 proves auth passed and the handler ran.
      ["lifting session", liftingSession(req(raw), ctx({ id: nil }))],
      ["lifting lift", liftingLift(req(raw), ctx({ templateId: "no-such-template" }))],
      ["ride", ride(req(raw, `/api/rides/${nil}?streams=1`), ctx({ id: nil }))],
      ["vitals day", vitalsDay(req(raw), ctx({ date: "1990-01-01" }))],
    ];
    for (const [name, res] of reads) {
      const status = (await res).status;
      expect([name, status === 200 || status === 404]).toEqual([name, true]);
    }
  });

  it("logs a weight and adds + checks a shopping item", async () => {
    const { raw } = await phone();
    const w = await weightCreate(req(raw, "/api/weight/entries", { method: "POST", body: { measuredOn: WEIGHT_DAY, weight: 150 } }));
    expect(w.status).toBe(200);
    expect((await getEntryByDay(WEIGHT_DAY))?.weight).toBe(150);

    const s = await shoppingCreate(req(raw, "/api/shopping/items", { method: "POST", body: { category: "zzz-scope", text: "scope-me" } }));
    expect(s.status).toBe(201);
    const { id } = await s.json();
    shoppingIds.push(id);
    const p = await shoppingPatch(req(raw, `/api/shopping/items/${id}`, { method: "PATCH", body: { status: "bought" } }), ctx({ id }));
    expect(p.status).toBe(200);
    expect((await getItemById(id))?.status).toBe("bought");
  });

  it("is rejected (401) by every route off the list — one per module", async () => {
    const { raw } = await phone();
    const item = await addItem({ category: "zzz-scope", text: "keep-me" });
    shoppingIds.push(item.id);
    const nil = "00000000-0000-0000-0000-000000000000";
    const offList: [string, Promise<Response>][] = [
      ["macros range", macrosRange(req(raw, "/api/macros/range?start=2026-10-01&end=2026-10-02"))],
      ["macros entry create", macrosEntryCreate(req(raw, "/api/macros/entries", { method: "POST", body: {} }))],
      ["weight delete", weightDelete(req(raw, `/api/weight/entries/${nil}`, { method: "DELETE" }), ctx({ id: nil }))],
      ["lifting patch", liftingSessionPatch(req(raw, `/api/lifting/sessions/${nil}`, { method: "PATCH", body: {} }), ctx({ id: nil }))],
      ["ride patch", ridePatch(req(raw, `/api/rides/${nil}`, { method: "PATCH", body: {} }), ctx({ id: nil }))],
      ["ride raw file", rideFit(req(raw, `/api/rides/${nil}/fit`), ctx({ id: nil }))],
      ["vitals delete", vitalsDelete(req(raw, "/api/vitals/2026-10-01", { method: "DELETE" }), ctx({ date: "2026-10-01" }))],
      ["shopping items read", shoppingItems(req(raw, "/api/shopping/items"))],
      ["shopping hard delete", shoppingDelete(req(raw, `/api/shopping/items/${item.id}?hard=true`, { method: "DELETE" }), ctx({ id: item.id }))],
    ];
    for (const [name, res] of offList) expect([name, (await res).status]).toEqual([name, 401]);
    expect(await getItemById(item.id)).not.toBeNull(); // the hard delete didn't touch it
  });

  it("soft-deletes a shopping item (swipe to delete) but can never hard-delete one", async () => {
    const { raw } = await phone();
    const item = await addItem({ category: "zzz-scope", text: "swipe-me" });
    shoppingIds.push(item.id);
    const path = `/api/shopping/items/${item.id}`;
    expect((await shoppingDelete(req(raw, `${path}?hard=true`, { method: "DELETE" }), ctx({ id: item.id }))).status).toBe(401);
    expect(await getItemById(item.id)).not.toBeNull();
    expect((await shoppingDelete(req(raw, path, { method: "DELETE" }), ctx({ id: item.id }))).status).toBe(204);
    expect(await getItemById(item.id)).toBeNull(); // soft-deleted: gone from reads, row kept (hard-deleted in afterAll)
  });

  it("is rejected (401) on every route once revoked", async () => {
    const { raw, id } = await phone();
    await revokeDeviceToken(id);
    expect((await weightRollup(req(raw, "/api/weight/rollup"))).status).toBe(401);
    expect((await shoppingList(req(raw, "/api/shopping/list"))).status).toBe(401);
  });
});

describe("the weigh-in token — a phone's child credential for Siri (ios-app.md §3.3.7)", () => {
  const mint = async (raw: string | null) => weighInToken(req(raw, "/api/weight/weigh-in-token", { method: "POST" }));
  const minted = async (raw: string) => {
    const res = await mint(raw);
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(201);
    const parsed = mintedTokenSchema.parse(json);
    expect(parsed).toEqual(json); // nothing undeclared in the response
    return parsed;
  };

  it("a phone mints one: weight scopes only, named after its parent, never cached", async () => {
    const { raw, id } = await phone();
    const res = await mint(raw);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const child = mintedTokenSchema.parse(await res.json());
    expect(child.token).toMatch(/^jmw_/);
    expect(child.token).not.toBe(raw);
    expect(child.scopes).toEqual(WEIGH_IN_SCOPES);
    expect(child.name).toBe("test-scope · Siri weigh-in");
    const row = (await listDeviceTokens()).find((t) => t.name === child.name && t.parentId === id);
    expect(row?.revokedAt).toBeNull();
  });

  it("logs and reads weigh-ins, and nothing else", async () => {
    const child = (await minted((await phone()).raw)).token;
    const w = await weightCreate(req(child, "/api/weight/entries", { method: "POST", body: { measuredOn: WEIGHT_DAY, weight: 151 } }));
    expect(w.status).toBe(200);
    expect((await getEntryByDay(WEIGHT_DAY))?.weight).toBe(151);
    expect((await weightDay(req(child), ctx({ date: WEIGHT_DAY }))).status).toBe(200);
    expect((await weightRollup(req(child, "/api/weight/rollup"))).status).toBe(200);

    const nil = "00000000-0000-0000-0000-000000000000";
    const refused: [string, Promise<Response>][] = [
      ["macros day", macrosDay(req(child), ctx({ date: "2026-10-01" }))],
      ["lifting sessions", liftingSessions(req(child, "/api/lifting/sessions"))],
      ["rides", rides(req(child, "/api/rides"))],
      ["vitals list", vitalsList(req(child, "/api/vitals"))],
      ["shopping list", shoppingList(req(child, "/api/shopping/list"))],
      ["shopping create", shoppingCreate(req(child, "/api/shopping/items", { method: "POST", body: { category: "zzz-scope", text: "no" } }))],
      ["weight delete", weightDelete(req(child, `/api/weight/entries/${nil}`, { method: "DELETE" }), ctx({ id: nil }))],
    ];
    for (const [name, res] of refused) expect([name, (await res).status]).toEqual([name, 401]);
    expect(requireBearer(req(child)).ok).toBe(false);
    expect(requirePrimary(req(child)).ok).toBe(false);
  });

  it("can't mint a token of its own (no chains)", async () => {
    const child = (await minted((await phone()).raw)).token;
    expect((await mint(child)).status).toBe(401);
  });

  it("dies with its parent: revoking the phone revokes the weigh-in token", async () => {
    const { raw, id } = await phone();
    const child = (await minted(raw)).token;
    expect((await requireScope(req(child), "weight:write")).ok).toBe(true);
    expect(await revokeDeviceToken(id)).toBe(true);
    expect((await requireScope(req(child), "weight:write")).ok).toBe(false);
    const rows = (await listDeviceTokens()).filter((t) => t.parentId === id);
    expect(rows.length).toBe(1);
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
  });

  it("is dead while its parent is, even if only the parent's row changed", async () => {
    const { raw, id } = await phone();
    const child = (await minted(raw)).token;
    await db.update(deviceToken).set({ deletedAt: new Date() }).where(eq(deviceToken.id, id)); // parent only
    expect((await requireScope(req(child), "weight:read")).ok).toBe(false);
  });

  it("minting again replaces the previous one", async () => {
    const { raw, id } = await phone();
    const first = (await minted(raw)).token;
    const second = (await minted(raw)).token;
    expect((await requireScope(req(first), "weight:write")).ok).toBe(false);
    expect((await requireScope(req(second), "weight:write")).ok).toBe(true);
    const live = (await listDeviceTokens()).filter((t) => t.parentId === id && !t.revokedAt);
    expect(live.length).toBe(1);
    expect((await requireScope(req(raw), "vitals:read")).ok).toBe(true); // the phone itself is untouched
  });

  it("revoking only the weigh-in token leaves the phone working", async () => {
    const { raw, id } = await phone();
    const child = (await minted(raw)).token;
    const row = (await listDeviceTokens()).find((t) => t.parentId === id)!;
    expect(await revokeDeviceToken(row.id)).toBe(true);
    expect((await requireScope(req(child), "weight:write")).ok).toBe(false);
    expect((await requireScope(req(raw), "weight:write")).ok).toBe(true);
  });

  it("refuses everyone who isn't a device holding both weight scopes", async () => {
    expect((await mint(null)).status).toBe(401);
    expect((await mint("jmw_not-a-real-token")).status).toBe(401);
    // The env tokens aren't devices: there is no parent for a child to hang from.
    expect((await mint(primary)).status).toBe(401);
    expect((await mint(agent)).status).toBe(401);
    const narrow = await createDeviceToken({ name: "test-scope-narrow", scopes: ["weight:read"] });
    expect((await mint(narrow.raw)).status).toBe(401); // a child never holds more than its parent
    const panel = await createDeviceToken({ name: "test-scope-panel", scopes: ["panel:read", "panel:write:shopping"] });
    expect((await mint(panel.raw)).status).toBe(401);
    const revoked = await phone();
    await revokeDeviceToken(revoked.id);
    expect((await mint(revoked.raw)).status).toBe(401);
  });

  it("requireDevice names the device, and turns the env tokens away", async () => {
    const { raw, id } = await phone();
    expect(await requireDevice(req(raw))).toMatchObject({ ok: true, device: { id, parentId: null } });
    expect((await requireDevice(req(primary))).ok).toBe(false);
    expect((await requireDevice(req(agent))).ok).toBe(false);
  });
});
