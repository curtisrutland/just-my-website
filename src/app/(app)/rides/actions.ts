"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { rideTitle } from "@/components/rides/format";
import { FitDecodeError } from "@/lib/rides/fit";
import { ingestFitFile } from "@/lib/rides/ingest";
import { patchRide, softDeleteRide } from "@/lib/rides/repo";
import { ridePatchSchema } from "@/lib/rides/schema";

/**
 * Rides web write paths (CONVENTIONS §1): the UI writes through the SAME pipeline as the token
 * API — uploads via the shared `ingestFitFile` (decode → `fitRideSchema.parse` → repo), the
 * human layer via `ridePatchSchema.parse → repo`. The UI never calls the API.
 */

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

const MAX_BYTES = 15 * 1024 * 1024;

export type UploadOutcome = {
  file: string;
  status: "ingested" | "deduped" | "failed";
  /** One honest line: the ride it became, the ride it already was, or why it failed. */
  detail: string;
};

/** Ingest ONE FIT file (the client calls this once per dropped file, so each row resolves
 *  independently). Failures return an outcome — they never throw across the wire. */
export async function uploadFitAction(formData: FormData): Promise<UploadOutcome> {
  await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File)) return { file: "?", status: "failed", detail: "no file in request" };
  if (file.size === 0) return { file: file.name, status: "failed", detail: "empty file" };
  if (file.size > MAX_BYTES) return { file: file.name, status: "failed", detail: "over the 15 MB limit" };
  try {
    const { ride, deduped } = await ingestFitFile(Buffer.from(await file.arrayBuffer()));
    revalidatePath("/rides");
    return deduped
      ? { file: file.name, status: "deduped", detail: `already have this one · ${rideTitle(ride)}` }
      : { file: file.name, status: "ingested", detail: `new ride · ${rideTitle(ride)}` };
  } catch (e) {
    if (e instanceof FitDecodeError) return { file: file.name, status: "failed", detail: e.message };
    if (e instanceof z.ZodError) return { file: file.name, status: "failed", detail: "decoded shape failed validation" };
    throw e;
  }
}

/** Save (or clear, via empty string) the ride's name — the human layer. */
export async function saveNameAction(id: string, name: string) {
  await requireUser();
  const patch = ridePatchSchema.parse({ name: name.trim() ? name.trim() : null });
  await patchRide(id, patch);
  revalidatePath(`/rides/${id}`);
  revalidatePath("/rides");
}

/** Save (or clear) the ride's note — the only other writable field. */
export async function saveNoteAction(id: string, note: string) {
  await requireUser();
  const patch = ridePatchSchema.parse({ note: note.trim() ? note : null });
  await patchRide(id, patch);
  revalidatePath(`/rides/${id}`);
  revalidatePath("/rides");
}

/** Soft-delete (a bad upload). The raw file stays in Blob; re-uploading it restores the ride
 *  as a fresh row. */
export async function deleteRideAction(id: string) {
  await requireUser();
  await softDeleteRide(id);
  revalidatePath("/rides");
}
