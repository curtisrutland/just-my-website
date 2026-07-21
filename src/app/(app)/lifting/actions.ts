"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { catchUp, patchAnnotation } from "@/lib/lifting/repo";
import { liftingAnnotationPatchSchema } from "@/lib/lifting/schema";

/**
 * Lifting web write path (CONVENTIONS §1): the UI writes the annotation directly through
 * `schema.parse → repo`, never via the token API. Curtis owns `sessionNotes` and `quality`
 * (edited here); `interpretation` and `focus` are Claude's, written via the skill — no editor here.
 */

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

/** Save the session notes (Curtis's context). Empty → cleared to null. */
export async function saveNotesAction(id: string, notes: string) {
  await requireUser();
  const patch = liftingAnnotationPatchSchema.parse({ sessionNotes: notes.trim() ? notes : null });
  await patchAnnotation(id, patch);
  revalidatePath(`/lifting/${id}`);
  revalidatePath("/lifting");
}

/** Set (or clear) the subjective 1–5 quality score. */
export async function setQualityAction(id: string, quality: number | null) {
  await requireUser();
  const patch = liftingAnnotationPatchSchema.parse({ quality });
  await patchAnnotation(id, patch);
  revalidatePath(`/lifting/${id}`);
  revalidatePath("/lifting");
}

/** "Catch up from Hevy" — pull recent workouts so a missed webhook is recoverable by hand. */
export async function catchUpAction() {
  await requireUser();
  await catchUp({ pages: 2 });
  revalidatePath("/lifting");
}
