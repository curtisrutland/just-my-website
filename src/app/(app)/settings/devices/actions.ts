"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createDeviceToken, revokeDeviceToken } from "@/lib/auth/device-tokens";
import { originFrom, pairingPayload } from "@/lib/auth/pairing";
import { PHONE_SCOPES } from "@/lib/auth/scopes";

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
}

export type Pairing = { name: string; payload: string; qrSvg: string };

/**
 * Mint a phone token and return its pairing code ONCE (`docs/ios-app.md` §4.1). The raw token lives
 * only in this response and the page's state: it isn't stored, and the API never sees it.
 */
export async function pairPhoneAction(rawName: string): Promise<Pairing> {
  await requireUser();
  const name = rawName.trim().slice(0, 60) || "iPhone";
  const { raw } = await createDeviceToken({ name, scopes: PHONE_SCOPES });
  const payload = pairingPayload({ base: originFrom(await headers()), token: raw, name });
  const qrSvg = await QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  revalidatePath("/settings/devices");
  return { name, payload, qrSvg };
}

/** Revoke any device token: the iPhone, the kitchen panel, the recipes sender. Its row stays, revoked. */
export async function revokeDeviceAction(id: string) {
  await requireUser();
  await revokeDeviceToken(id);
  revalidatePath("/settings/devices");
}
