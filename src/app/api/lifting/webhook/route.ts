import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import * as z from "zod";
import { parseJson, unauthorized } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { getWorkout } from "@/lib/lifting/hevy";
import { upsertSessionFromHevy } from "@/lib/lifting/repo";
import { hevyWorkoutSchema, normalizeWorkout } from "@/lib/lifting/schema";

/**
 * POST /api/lifting/webhook — Hevy's real-time ingestion trigger. THE documented kernel carve-out
 * (AGENTS.md / docs/lifting-model.md): this one route authenticates with a dedicated webhook secret
 * (`HEVY_WEBHOOK_TOKEN`), NOT a JMW token, because Hevy can only send a fixed `Authorization` header.
 * It is write-only and never serves a read, so "no anonymous reads" is preserved; only "every write
 * carries a JMW token" is relaxed here, for exactly one caller. Everything still flows through
 * `hevyWorkoutSchema.parse → normalize → repo`.
 *
 * The body `{ workoutId }` is a TRIGGER, never trusted as data — we pull the full workout ourselves.
 * Hevy expects a 200 within 5s; a single-workout inline pull is well within budget.
 */

const triggerSchema = z.object({ workoutId: z.string().min(1) });

/** Constant-time compare of the inbound Authorization header against `Bearer <HEVY_WEBHOOK_TOKEN>`. */
function verifyWebhook(request: NextRequest): boolean {
  const token = process.env.HEVY_WEBHOOK_TOKEN;
  if (!token) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const a = createHash("sha256").update(header.trim()).digest();
  const b = createHash("sha256").update(`Bearer ${token}`).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!verifyWebhook(request)) return unauthorized("Invalid webhook token");

  const parsed = await parseJson(request, triggerSchema);
  if (!parsed.ok) return parsed.response;

  const raw = await getWorkout(parsed.data.workoutId);
  const session = await upsertSessionFromHevy(normalizeWorkout(hevyWorkoutSchema.parse(raw), raw));
  return ok({ ok: true, sessionId: session.id, hevyId: session.hevyId });
}
