"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { patchEntry, softDeleteEntry } from "@/lib/macros/repo";
import { entryPatchSchema } from "@/lib/macros/schema";

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

/** Correct an entry's numbers/confidence (Option A: the web corrects; Claude adds). */
export async function patchEntryAction(date: string, entryId: string, formData: FormData) {
  await requireUser();

  const patch: Record<string, unknown> = {};
  const qty = formData.get("quantityGrams");
  if (qty != null && qty !== "") patch.quantityGrams = Number(qty);
  for (const key of ["calories", "proteinContent", "fatContent", "carbohydrateContent"] as const) {
    const v = formData.get(key);
    if (v != null) patch[key] = v === "" ? null : Number(v);
  }
  const confidence = formData.get("confidence");
  if (confidence) patch.confidence = String(confidence);

  const parsed = entryPatchSchema.parse(patch);
  await patchEntry(entryId, parsed);
  revalidatePath(`/macros/${date}`);
}

export async function deleteEntryAction(date: string, entryId: string) {
  await requireUser();
  await softDeleteEntry(entryId);
  revalidatePath(`/macros/${date}`);
}
