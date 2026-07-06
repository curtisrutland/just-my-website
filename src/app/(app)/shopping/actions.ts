"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { addItem, patchItem, softDeleteItem } from "@/lib/shopping/repo";
import { shoppingCreateSchema, shoppingPatchSchema } from "@/lib/shopping/schema";

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

/** Add an item from the web (full editor). Returns the new id so the client can reconcile the
 *  optimistic row it inserted. */
export async function addItemAction(input: { category: string; text: string }): Promise<{ id: string }> {
  await requireUser();
  const parsed = shoppingCreateSchema.parse(input);
  const item = await addItem(parsed);
  revalidatePath("/shopping");
  return { id: item.id };
}

/** Edit category/text and/or transition status (check ⇄ un-check). */
export async function patchItemAction(
  id: string,
  patch: { category?: string; text?: string; status?: "needed" | "bought" }
): Promise<void> {
  await requireUser();
  const parsed = shoppingPatchSchema.parse(patch);
  await patchItem(id, parsed);
  revalidatePath("/shopping");
}

/** Soft-delete ("added by mistake"). */
export async function deleteItemAction(id: string): Promise<void> {
  await requireUser();
  await softDeleteItem(id);
  revalidatePath("/shopping");
}
