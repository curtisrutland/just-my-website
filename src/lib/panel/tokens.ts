import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceToken } from "@/lib/db/schema";
import type { PanelScope } from "./scopes";

/**
 * Device/service tokens for the panel (panel-contract §3). This is the ONLY place the
 * `device_tokens` table is touched. High-entropy random tokens: we store only sha256(raw), so a
 * plain indexed hash lookup is both the auth check and safe at rest (the hash is not reversible and
 * the raw never lands in the DB). No bcrypt/argon needed — there is nothing low-entropy to stretch.
 */

/** sha256(raw) as hex — what we store and what we look up by. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A fresh opaque token. `jmw_` prefix is cosmetic; scopes (not the prefix) decide access. */
export function generateRawToken(): string {
  return "jmw_" + randomBytes(32).toString("base64url");
}

export type DeviceTokenIdentity = {
  id: string;
  name: string;
  scopes: PanelScope[];
};

/**
 * Resolve a raw bearer token to a live identity, or null if it is unknown, revoked, or soft-deleted.
 * Direct hash lookup — no full-table scan, no timing concern (we compare hashes in the index, and a
 * hash reveals nothing about the stored secret).
 */
export async function findLiveTokenByRaw(raw: string): Promise<DeviceTokenIdentity | null> {
  const [row] = await db
    .select()
    .from(deviceToken)
    .where(
      and(
        eq(deviceToken.tokenHash, hashToken(raw)),
        isNull(deviceToken.revokedAt),
        isNull(deviceToken.deletedAt)
      )
    )
    .limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, scopes: row.scopes as PanelScope[] };
}

/**
 * Mint a device token. Returns the RAW token exactly once (it is never retrievable afterward) plus
 * the stored row's id/name/scopes. Caller is responsible for surfacing the raw value to the operator.
 */
export async function createDeviceToken(opts: {
  name: string;
  scopes: PanelScope[];
}): Promise<{ raw: string; id: string; name: string; scopes: PanelScope[] }> {
  const raw = generateRawToken();
  const [row] = await db
    .insert(deviceToken)
    .values({ name: opts.name, tokenHash: hashToken(raw), scopes: opts.scopes })
    .returning();
  return { raw, id: row.id, name: row.name, scopes: row.scopes as PanelScope[] };
}
