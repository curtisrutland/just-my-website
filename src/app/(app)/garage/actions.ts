"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { todayISO } from "@/lib/date";
import { attribute, createBike, createRideTag, GarageError, patchBike, patchRideTag, softDeleteRideTag, tagsForActivities } from "@/lib/garage/repo";
import { bikeCreateSchema, bikePatchSchema, rideTagPatchSchema } from "@/lib/garage/schema";
import type { AttributeResult } from "@/lib/garage/types";
import { getRide, listRides } from "@/lib/rides/repo";
import { rideFacts } from "./facts";

/**
 * Garage web write paths (CONVENTIONS §1): `schema.parse → repo`, the same as the token API. The
 * page is a surface, so it may read rides and hand their facts to the garage; neither module reads
 * the other. The UI never calls the API.
 */

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

function refresh() {
  revalidatePath("/garage");
  revalidatePath("/rides", "layout");
}

/** A refusal the form shows inline (a name or profile clash, a bad year); anything else throws. */
function message(e: unknown): string {
  if (e instanceof GarageError) return e.message;
  if (e instanceof z.ZodError) return e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  throw e;
}

export type BikeForm = { name: string; brand: string; model: string; modelYear: string; note: string; profiles: string };

const profileList = (raw: string) => raw.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);

/** Add (no id) or edit a bike, then apply the rules to every ride so a new profile reaches the old ones. */
export async function saveBikeAction(id: string | null, form: BikeForm): Promise<{ error?: string }> {
  await requireUser();
  try {
    const fields = {
      name: form.name.trim() || undefined,
      brand: form.brand,
      model: form.model,
      modelYear: Number(form.modelYear),
      note: form.note.trim() || null,
      profiles: profileList(form.profiles),
    };
    if (id) await patchBike(id, bikePatchSchema.parse(fields));
    else await createBike(bikeCreateSchema.parse(fields));
    await sweep();
  } catch (e) {
    return { error: message(e) };
  }
  refresh();
  return {};
}

/** Retire a bike today (its rules go, its rides stay), or bring it back. */
export async function setRetiredAction(id: string, retired: boolean): Promise<{ error?: string }> {
  await requireUser();
  try {
    await patchBike(id, bikePatchSchema.parse({ retiredOn: retired ? todayISO() : null }));
  } catch (e) {
    return { error: message(e) };
  }
  refresh();
  return {};
}

/** Put a ride on a bike by hand, move it, or (empty bikeId) untag it. */
export async function tagRideAction(activityId: string, bikeId: string): Promise<{ error?: string }> {
  await requireUser();
  try {
    const existing = (await tagsForActivities([activityId])).get(activityId);
    if (!bikeId) {
      if (existing) await softDeleteRideTag(existing.id);
    } else if (existing) {
      if (existing.bikeId !== bikeId) await patchRideTag(existing.id, rideTagPatchSchema.parse({ bikeId }));
    } else {
      const ride = await getRide(activityId);
      if (!ride) return { error: "Ride not found" };
      await createRideTag({ ...rideFacts(ride), bikeId });
    }
  } catch (e) {
    return { error: message(e) };
  }
  refresh();
  return {};
}

/** Every ride (oldest pages included), as facts for the rules. */
async function sweep(): Promise<AttributeResult> {
  const facts = [];
  for (let offset = 0; ; offset += 200) {
    const { items, count } = await listRides({ limit: 200, offset });
    facts.push(...items.map(rideFacts));
    if (offset + 200 >= count) break;
  }
  return facts.length ? attribute(facts) : { tagged: [], unchanged: [], unmatched: [] };
}

/** "Apply rules": run every ride through the profile rules. Hand tags are never touched. */
export async function applyRulesAction(): Promise<{ tagged: number }> {
  await requireUser();
  const result = await sweep();
  refresh();
  return { tagged: result.tagged.length };
}
