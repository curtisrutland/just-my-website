import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/lib/db";
import { deviceToken } from "@/lib/db/schema";
import { kv } from "@/lib/kv";
import type { DeviceScope } from "./scopes";

/**
 * Device/service tokens (CONVENTIONS §2): the panel and its recipes sender (panel-contract §3) and the
 * iOS app (`docs/ios-app.md` §3). This is the ONLY place the `device_tokens` table is touched. High-entropy random tokens: we store only sha256(raw), so a
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
  scopes: DeviceScope[];
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
  return { id: row.id, name: row.name, scopes: row.scopes as DeviceScope[] };
}

/**
 * KV-cached variant, for the version-poll HOT PATH ONLY (panel-contract §4.1 forbids Neon there — a
 * per-poll device-token lookup would keep Neon awake 24/7). Checks KV first; on miss, falls back to
 * the Neon lookup and caches the identity for `TOKEN_CACHE_TTL_SECONDS`. Falls straight through to
 * Neon if KV is unavailable.
 *
 * Tradeoff: revocation lags on THIS path by up to the TTL — acceptable because the only thing it
 * guards is the three-integer version read, and every write/section route uses the DIRECT
 * (immediate-revocation) `findLiveTokenByRaw`. `revokeDeviceToken` DELs the cache key, so revocation doesn't wait out the TTL.
 */
const TOKEN_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h backstop
const tokenCacheKey = (hash: string) => `panel:tok:${hash}`;

export async function findLiveTokenByRawCached(raw: string): Promise<DeviceTokenIdentity | null> {
  const client = kv();
  const hash = hashToken(raw);
  if (client) {
    try {
      const hit = await client.get<DeviceTokenIdentity>(tokenCacheKey(hash));
      if (hit) return hit;
    } catch {
      // KV read failed → fall through to Neon
    }
  }
  const identity = await findLiveTokenByRaw(raw);
  if (identity && client) {
    try {
      await client.set(tokenCacheKey(hash), identity, { ex: TOKEN_CACHE_TTL_SECONDS });
    } catch {
      // cache write failed → harmless; next poll retries
    }
  }
  return identity;
}

/**
 * Mint a device token. Returns the RAW token exactly once (it is never retrievable afterward) plus
 * the stored row's id/name/scopes. Caller is responsible for surfacing the raw value to the operator.
 */
export async function createDeviceToken(opts: {
  name: string;
  scopes: DeviceScope[];
}): Promise<{ raw: string; id: string; name: string; scopes: DeviceScope[] }> {
  const raw = generateRawToken();
  const [row] = await db
    .insert(deviceToken)
    .values({ name: opts.name, tokenHash: hashToken(raw), scopes: opts.scopes })
    .returning();
  return { raw, id: row.id, name: row.name, scopes: row.scopes as DeviceScope[] };
}

/** One device token as the devices page lists it: never the hash. */
export type DeviceTokenRow = {
  id: string;
  name: string;
  scopes: DeviceScope[];
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};

/** Every device token that isn't soft-deleted, revoked ones included (newest first), for `/settings/devices`. */
export async function listDeviceTokens(): Promise<DeviceTokenRow[]> {
  const rows = await db
    .select({
      id: deviceToken.id,
      name: deviceToken.name,
      scopes: deviceToken.scopes,
      createdAt: deviceToken.createdAt,
      lastSeenAt: deviceToken.lastSeenAt,
      revokedAt: deviceToken.revokedAt,
    })
    .from(deviceToken)
    .where(isNull(deviceToken.deletedAt))
    .orderBy(desc(deviceToken.createdAt));
  return rows.map((r) => ({ ...r, scopes: r.scopes as DeviceScope[] }));
}

/**
 * Revoke a device. Sets `revoked_at` (the audit row stays) and drops the version-poll cache entry, so
 * revocation is immediate on every path — the direct lookup never sees the token again, and the cached
 * one can't serve it from KV for up to a day. Returns false if no live token has that id.
 */
export async function revokeDeviceToken(id: string): Promise<boolean> {
  const [row] = await db
    .update(deviceToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceToken.id, id), isNull(deviceToken.revokedAt), isNull(deviceToken.deletedAt)))
    .returning();
  if (!row) return false;
  const client = kv();
  if (client) {
    try {
      await client.del(tokenCacheKey(row.tokenHash));
    } catch {
      // KV unavailable → the cached entry ages out at its TTL; the direct lookup already rejects
    }
  }
  return true;
}

/**
 * Best-effort "last used" stamp, run after the response so auth never waits on it. Outside a request
 * scope (scripts, tests) `after` throws, so it falls back to a detached write. NEVER called from the
 * version-poll path (that would keep Neon awake — panel-contract §4.1).
 */
export function touchLastSeen(id: string): void {
  const stamp = () =>
    db
      .update(deviceToken)
      .set({ lastSeenAt: new Date() })
      .where(eq(deviceToken.id, id))
      .then(
        () => undefined,
        () => undefined
      );
  try {
    after(stamp);
  } catch {
    void stamp();
  }
}
