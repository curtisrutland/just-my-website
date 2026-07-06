"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { patchEntry, setDayTag, softDeleteDayTag, softDeleteEntry } from "@/lib/macros/repo";
import { dayTagCreateSchema, entryPatchSchema } from "@/lib/macros/schema";

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

/**
 * Set (or clear) a day's kind from the header control. training/rest set the tag through the same
 * schema.parse → repo path as the API; unspecified clears it (absence = unspecified). Server actions
 * are untrusted entry points, so we re-check auth here even though the proxy also gates the route.
 */
export async function setDayKindAction(date: string, formData: FormData) {
  await requireUser();
  const kind = String(formData.get("kind") ?? "");
  if (kind === "unspecified") {
    await softDeleteDayTag(date);
  } else {
    const parsed = dayTagCreateSchema.parse({ day: date, kind });
    await setDayTag(parsed);
  }
  revalidatePath(`/macros/${date}`);
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
