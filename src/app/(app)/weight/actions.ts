"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { patchEntry, setWeight, softDeleteEntry } from "@/lib/weight/repo";
import { weightCreateSchema, weightPatchSchema } from "@/lib/weight/schema";

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

/** Log/replace a day's weight from the web entry form. */
export async function setWeightAction(measuredOn: string, formData: FormData) {
  await requireUser();
  const weight = Number(formData.get("weight"));
  if (!Number.isFinite(weight) || weight <= 0) return; // ignore blank/invalid input
  const note = String(formData.get("note") ?? "").trim();
  const parsed = weightCreateSchema.parse({ measuredOn, weight, note: note || null });
  await setWeight(parsed);
  revalidatePath("/weight");
}

/** Correct a raw weight inline from the list. */
export async function patchWeightAction(entryId: string, formData: FormData) {
  await requireUser();
  const weight = Number(formData.get("weight"));
  if (!Number.isFinite(weight) || weight <= 0) return;
  const patch = weightPatchSchema.parse({ weight });
  await patchEntry(entryId, patch);
  revalidatePath("/weight");
}

export async function deleteWeightAction(entryId: string) {
  await requireUser();
  await softDeleteEntry(entryId);
  revalidatePath("/weight");
}
