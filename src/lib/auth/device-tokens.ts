import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/lib/db";
import { deviceToken } from "@/lib/db/schema";
import { kv } from "@/lib/kv";
import { WEIGH_IN_SCOPES, type DeviceScope } from "./scopes";

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
  /** Set on a child token (`docs/ios-app.md` §3.3.7); null on an ordinary one. */
  parentId: string | null;
};

/**
 * Resolve a raw bearer token to a live identity, or null if it is unknown, revoked, or soft-deleted.
 * Direct hash lookup — no full-table scan, no timing concern (we compare hashes in the index, and a
 * hash reveals nothing about the stored secret). A child token is live only while its parent is, so
 * revoking a phone kills its weigh-in token even if the child's own row were somehow left alone.
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
  if (row.parentId) {
    const [parent] = await db
      .select({ id: deviceToken.id })
      .from(deviceToken)
      .where(and(eq(deviceToken.id, row.parentId), isNull(deviceToken.revokedAt), isNull(deviceToken.deletedAt)))
      .limit(1);
    if (!parent) return null;
  }
  return { id: row.id, name: row.name, scopes: row.scopes as DeviceScope[], parentId: row.parentId };
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
  parentId?: string;
}): Promise<{ raw: string; id: string; name: string; scopes: DeviceScope[] }> {
  const raw = generateRawToken();
  const [row] = await db
    .insert(deviceToken)
    .values({ name: opts.name, tokenHash: hashToken(raw), scopes: opts.scopes, parentId: opts.parentId ?? null })
    .returning();
  return { raw, id: row.id, name: row.name, scopes: row.scopes as DeviceScope[] };
}

/**
 * Mint a device's weigh-in token (`docs/ios-app.md` §3.3.7): a child of `parent` holding
 * `WEIGH_IN_SCOPES` and nothing else. The rules, all enforced here rather than at the call site:
 *
 *  - the parent must itself hold every scope the child gets — a child never has more than its parent;
 *  - a child can't mint (no chains), so a leaked weigh-in token can't make more of itself;
 *  - a device has at most one live weigh-in token: minting again revokes the previous one.
 *
 * Returns null when the parent isn't allowed to mint. The raw token is returned exactly once.
 */
export async function mintWeighInToken(
  parent: DeviceTokenIdentity
): Promise<{ raw: string; id: string; name: string; scopes: DeviceScope[] } | null> {
  if (parent.parentId) return null;
  if (!WEIGH_IN_SCOPES.every((scope) => parent.scopes.includes(scope))) return null;
  await revokeChildren(parent.id);
  return createDeviceToken({ name: `${parent.name} · Siri weigh-in`, scopes: WEIGH_IN_SCOPES, parentId: parent.id });
}

/** Revoke every live child of a token, dropping any cache entries. Returns how many were revoked. */
async function revokeChildren(parentId: string): Promise<number> {
  const rows = await db
    .update(deviceToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceToken.parentId, parentId), isNull(deviceToken.revokedAt), isNull(deviceToken.deletedAt)))
    .returning();
  await Promise.all(rows.map((row) => dropCached(row.tokenHash)));
  return rows.length;
}

async function dropCached(tokenHash: string): Promise<void> {
  const client = kv();
  if (!client) return;
  try {
    await client.del(tokenCacheKey(tokenHash));
  } catch {
    // KV unavailable → the cached entry ages out at its TTL; the direct lookup already rejects
  }
}

/** One device token as the devices page lists it: never the hash. */
export type DeviceTokenRow = {
  id: string;
  name: string;
  scopes: DeviceScope[];
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  /** The token this one was minted by (a phone's weigh-in token); null for an ordinary token. */
  parentId: string | null;
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
      parentId: deviceToken.parentId,
    })
    .from(deviceToken)
    .where(isNull(deviceToken.deletedAt))
    .orderBy(desc(deviceToken.createdAt));
  return rows.map((r) => ({ ...r, scopes: r.scopes as DeviceScope[] }));
}

/**
 * Revoke a device. Sets `revoked_at` (the audit row stays) and drops the version-poll cache entry, so
 * revocation is immediate on every path — the direct lookup never sees the token again, and the cached
 * one can't serve it from KV for up to a day. Its child tokens are revoked with it. Returns false if
 * no live token has that id.
 */
export async function revokeDeviceToken(id: string): Promise<boolean> {
  const [row] = await db
    .update(deviceToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceToken.id, id), isNull(deviceToken.revokedAt), isNull(deviceToken.deletedAt)))
    .returning();
  if (!row) return false;
  await dropCached(row.tokenHash);
  await revokeChildren(row.id);
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
