import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import type * as z from "zod";
import { dayRollupSchema } from "@/lib/macros/schema";
import { weightEntryViewSchema, weightRollupSchema } from "@/lib/weight/schema";
import { liftProgressionSchema, sessionDetailSchema, sessionListSchema } from "@/lib/lifting/schema";
import { rideDetailSchema, rideListSchema, weeklyStatsSchema } from "@/lib/rides/schema";
import { vitalsDayViewSchema, vitalsRollupSchema } from "@/lib/vitals/schema";
import { shoppingItemRowSchema, shoppingListSchema } from "@/lib/shopping/schema";
import { getEntryByDay, hardDeleteEntry } from "@/lib/weight/repo";
import { hardDeleteItem } from "@/lib/shopping/repo";
import { listEntries } from "@/lib/macros/repo";
import { paginatedSchema } from "./view-schemas";

import { GET as macrosDay } from "@/app/api/macros/days/[date]/route";
import { GET as weightRollup } from "@/app/api/weight/rollup/route";
import { GET as weightList, POST as weightCreate } from "@/app/api/weight/entries/route";
import { GET as weightDay } from "@/app/api/weight/days/[date]/route";
import { GET as liftingSessions } from "@/app/api/lifting/sessions/route";
import { GET as liftingSession } from "@/app/api/lifting/sessions/[id]/route";
import { GET as liftingLift } from "@/app/api/lifting/lifts/[templateId]/route";
import { GET as rides } from "@/app/api/rides/route";
import { GET as ride } from "@/app/api/rides/[id]/route";
import { GET as ridesWeekly } from "@/app/api/rides/weekly/route";
import { GET as vitalsList } from "@/app/api/vitals/route";
import { GET as vitalsDay } from "@/app/api/vitals/[date]/route";
import { GET as vitalsSummary } from "@/app/api/vitals/summary/route";
import { GET as shoppingList } from "@/app/api/shopping/list/route";
import { POST as shoppingCreate } from "@/app/api/shopping/items/route";
import { PATCH as shoppingPatch } from "@/app/api/shopping/items/[id]/route";

/**
 * Response contract (#80): every operation the iOS app may call (`docs/ios-app.md` §3.4) returns
 * exactly the JSON its view schema describes — the schema the OpenAPI spec, and so the generated
 * Swift client, are built from. Two failures it catches:
 *   - a declared field missing or mistyped (the schema parse fails), and
 *   - an UNDECLARED field (views are plain `z.object`s, which strip unknown keys, so the parsed
 *     value no longer deep-equals the raw JSON).
 *
 * Integration, against live Neon, read paths over real data so every shape is exercised with
 * values, not just empty arrays. Writes use a 1990 weigh-in and a `zzz-contract` shopping item,
 * both hard-deleted after.
 */
const WEIGHT_DAY = "1990-01-02";
const shoppingIds: string[] = [];

afterAll(async () => {
  const w = await getEntryByDay(WEIGHT_DAY);
  if (w) await hardDeleteEntry(w.id);
  for (const id of shoppingIds) await hardDeleteItem(id);
});

const token = process.env.JMW_API_KEY!;
const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`https://x${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

/** Status, then the schema parse, then "nothing undeclared". Returns the JSON for follow-up calls. */
async function expectContract<S extends z.ZodType>(res: Promise<Response>, schema: S, status = 200): Promise<z.infer<S>> {
  const r = await res;
  const json = await r.json();
  expect(r.status, JSON.stringify(json).slice(0, 300)).toBe(status);
  const parsed = schema.safeParse(json);
  expect(parsed.success ? [] : parsed.error.issues.slice(0, 5)).toEqual([]);
  expect(parsed.data).toEqual(json);
  return json;
}

describe("response contract — the iOS allowlist", () => {
  it("macros: the day rollup", async () => {
    // The most recent day with entries, so the entry shape and a target are exercised with values.
    const { items } = await listEntries({ limit: 1 });
    expect(items.length).toBeGreaterThan(0);
    const day = await expectContract(macrosDay(req("/api/macros/days/x"), ctx({ date: items[0].consumedOn })), dayRollupSchema);
    expect(day.entries.length).toBeGreaterThan(0);
  });

  it("weight: rollup, list, day, and the upsert", async () => {
    const rollup = await expectContract(weightRollup(req("/api/weight/rollup?window=30")), weightRollupSchema);
    expect(rollup.series.length).toBeGreaterThan(0);
    const list = await expectContract(weightList(req("/api/weight/entries?limit=5")), paginatedSchema(weightEntryViewSchema));
    expect(list.items.length).toBeGreaterThan(0);
    await expectContract(weightDay(req("/api/weight/days/x"), ctx({ date: list.items[0].measuredOn })), weightEntryViewSchema);
    await expectContract(
      weightCreate(req("/api/weight/entries", { method: "POST", body: { measuredOn: WEIGHT_DAY, weight: 150.5, note: "contract" } })),
      weightEntryViewSchema
    );
  });

  it("lifting: sessions (with goal), a session, a lift's progression", async () => {
    const list = await expectContract(liftingSessions(req("/api/lifting/sessions?limit=5")), sessionListSchema);
    expect(list.items.length).toBeGreaterThan(0);
    const detail = await expectContract(liftingSession(req("/api/lifting/sessions/x"), ctx({ id: list.items[0].id })), sessionDetailSchema);
    const templateId = detail.exercises.find((e) => e.exerciseTemplateId)?.exerciseTemplateId;
    expect(templateId).toBeTruthy();
    const prog = await expectContract(liftingLift(req("/api/lifting/lifts/x"), ctx({ templateId: templateId! })), liftProgressionSchema);
    expect(prog.points.length).toBeGreaterThan(0);
  });

  it("rides: list, detail with and without the stream, weekly", async () => {
    const list = await expectContract(rides(req("/api/rides?limit=5")), rideListSchema);
    expect(list.items.length).toBeGreaterThan(0);
    const id = list.items[0].id;
    const bare = await expectContract(ride(req(`/api/rides/${id}`), ctx({ id })), rideDetailSchema);
    expect(bare.stream).toBeNull();
    const full = await expectContract(ride(req(`/api/rides/${id}?streams=1`), ctx({ id })), rideDetailSchema);
    expect(full.stream?.data.t.length).toBeGreaterThan(0);
    const weekly = await expectContract(ridesWeekly(req("/api/rides/weekly")), weeklyStatsSchema);
    expect(weekly.weeks.length).toBeGreaterThan(0);
  });

  it("vitals: list, a day, the summary", async () => {
    const list = await expectContract(vitalsList(req("/api/vitals?limit=5")), paginatedSchema(vitalsDayViewSchema));
    expect(list.items.length).toBeGreaterThan(0);
    await expectContract(vitalsDay(req("/api/vitals/x"), ctx({ date: list.items[0].measuredOn })), vitalsDayViewSchema);
    const summary = await expectContract(vitalsSummary(req("/api/vitals/summary?window=30")), vitalsRollupSchema);
    expect(summary.restingHeartRate.series.length).toBeGreaterThan(0);
  });

  it("shopping: add, check off, the list", async () => {
    const item = await expectContract(
      shoppingCreate(req("/api/shopping/items", { method: "POST", body: { category: "zzz-contract", text: "contract-me" } })),
      shoppingItemRowSchema,
      201
    );
    shoppingIds.push(item.id);
    await expectContract(
      shoppingPatch(req(`/api/shopping/items/${item.id}`, { method: "PATCH", body: { status: "bought" } }), ctx({ id: item.id })),
      shoppingItemRowSchema
    );
    const list = await expectContract(shoppingList(req("/api/shopping/list")), shoppingListSchema);
    expect(list.recentlyBought.some((i) => i.id === item.id)).toBe(true);
  });
});
