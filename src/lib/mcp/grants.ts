import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { after } from "next/server";
import { hashToken } from "@/lib/auth/device-tokens";
import { db } from "@/lib/db";
import { oauthGrant } from "@/lib/db/schema";
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  REFRESH_GRACE_SECONDS,
  resourceMatches,
  verifyPkce,
  type AuthorizeRequest,
  type McpScope,
} from "./oauth";

/**
 * OAuth grants for the MCP surface (`docs/mcp.md` §3). This is the ONLY place the `oauth_grants`
 * table is touched. Codes, access tokens and refresh tokens are high-entropy random strings stored
 * as sha256 hashes, exactly like device tokens: an indexed hash lookup is the whole check.
 *
 * Every failure at the token endpoint is the same `null` (the route answers `invalid_grant`): a
 * caller learns that the credential didn't work, never why.
 */

/** Prefixes are cosmetic (they make a leaked string recognisable); the hash lookup decides. */
const mint = (prefix: "jmwc_" | "jmwa_" | "jmwr_") => prefix + randomBytes(32).toString("base64url");

const live = () => and(isNull(oauthGrant.revokedAt), isNull(oauthGrant.deletedAt));
const inSeconds = (seconds: number, from: Date) => new Date(from.getTime() + seconds * 1000);

/**
 * Record an approval and return its one-time code. Called only from the consent page's action,
 * after the Clerk session check. Approvals that were never redeemed are swept (soft-deleted) here,
 * so abandoned sign-ins don't pile up.
 */
export async function createAuthorization(request: AuthorizeRequest, now: Date = new Date()): Promise<{ id: string; code: string }> {
  await db
    .update(oauthGrant)
    .set({ deletedAt: now })
    .where(and(isNull(oauthGrant.codeUsedAt), lt(oauthGrant.codeExpiresAt, now), isNull(oauthGrant.deletedAt)));
  const code = mint("jmwc_");
  const [row] = await db
    .insert(oauthGrant)
    .values({
      name: new URL(request.redirectUri).host,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      resource: request.resource,
      scopes: request.scopes,
      codeHash: hashToken(code),
      codeChallenge: request.codeChallenge,
      codeExpiresAt: inSeconds(CODE_TTL_SECONDS, now),
    })
    .returning({ id: oauthGrant.id });
  return { id: row.id, code };
}

/** What the token endpoint hands back. The raw tokens exist only in this value and the response. */
export type TokenSet = { accessToken: string; refreshToken: string; expiresIn: number; scopes: McpScope[] };

function freshTokens(now: Date) {
  const accessToken = mint("jmwa_");
  const refreshToken = mint("jmwr_");
  return {
    accessToken,
    refreshToken,
    columns: {
      accessHash: hashToken(accessToken),
      accessExpiresAt: inSeconds(ACCESS_TTL_SECONDS, now),
      refreshHash: hashToken(refreshToken),
    },
  };
}

/**
 * Redeem an authorization code (RFC 6749 §4.1.3 with PKCE). The code must be unexpired, unused,
 * presented by the client it was issued to, with the verifier for its challenge. Single use is
 * enforced by the UPDATE's `code_used_at IS NULL`, so two racing redemptions can't both win. A code
 * presented a second time revokes the grant it already produced (RFC 6749 §4.1.2).
 */
export async function redeemCode(
  input: { code: string; codeVerifier: string; clientId: string; redirectUri?: string; resource?: string },
  now: Date = new Date()
): Promise<TokenSet | null> {
  const [row] = await db
    .select()
    .from(oauthGrant)
    .where(and(eq(oauthGrant.codeHash, hashToken(input.code)), isNull(oauthGrant.deletedAt)))
    .limit(1);
  if (!row) return null;
  if (row.codeUsedAt) {
    await revokeGrant(row.id);
    return null;
  }
  if (row.revokedAt || row.codeExpiresAt <= now) return null;
  if (input.clientId !== row.clientId) return null;
  if (input.redirectUri !== undefined && input.redirectUri !== row.redirectUri) return null;
  if (!resourceMatches(input.resource, row.resource)) return null;
  if (!verifyPkce(input.codeVerifier, row.codeChallenge)) return null;

  const tokens = freshTokens(now);
  const [redeemed] = await db
    .update(oauthGrant)
    .set({ ...tokens.columns, codeUsedAt: now })
    .where(and(eq(oauthGrant.id, row.id), isNull(oauthGrant.codeUsedAt), live()))
    .returning({ id: oauthGrant.id });
  if (!redeemed) {
    await revokeGrant(row.id);
    return null;
  }
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: ACCESS_TTL_SECONDS, scopes: row.scopes as McpScope[] };
}

/**
 * Trade a refresh token for a new pair (RFC 6749 §6), rotating both: the old access token and the
 * old refresh token stop working in the same UPDATE that stores the new ones. The `refresh_hash =`
 * condition makes rotation single-use.
 *
 * A refresh token that was already replaced is refused. Within `REFRESH_GRACE_SECONDS` of the
 * rotation that is assumed to be a race and nothing else happens; after it, a replaced token coming
 * back means two parties hold this grant's credentials, and the grant is revoked.
 */
export async function refreshGrant(input: { refreshToken: string; clientId?: string }, now: Date = new Date()): Promise<TokenSet | null> {
  const presented = hashToken(input.refreshToken);
  const tokens = freshTokens(now);
  const [row] = await db
    .update(oauthGrant)
    .set({ ...tokens.columns, prevRefreshHash: presented, refreshRotatedAt: now })
    .where(and(eq(oauthGrant.refreshHash, presented), input.clientId ? eq(oauthGrant.clientId, input.clientId) : undefined, live()))
    .returning({ scopes: oauthGrant.scopes });
  if (row) {
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: ACCESS_TTL_SECONDS, scopes: row.scopes as McpScope[] };
  }

  const [replaced] = await db
    .select({ id: oauthGrant.id, refreshRotatedAt: oauthGrant.refreshRotatedAt })
    .from(oauthGrant)
    .where(and(eq(oauthGrant.prevRefreshHash, presented), live()))
    .limit(1);
  if (replaced?.refreshRotatedAt && inSeconds(REFRESH_GRACE_SECONDS, replaced.refreshRotatedAt) < now) {
    await revokeGrant(replaced.id);
  }
  return null;
}

/** Who an access token belongs to, as `/mcp` needs it. */
export type GrantIdentity = { id: string; name: string; clientId: string; scopes: McpScope[]; expiresAt: Date };

/** Resolve a raw access token to a live, unexpired grant, or null. Direct hash lookup, no cache. */
export async function findGrantByAccessToken(raw: string, now: Date = new Date()): Promise<GrantIdentity | null> {
  const [row] = await db
    .select({
      id: oauthGrant.id,
      name: oauthGrant.name,
      clientId: oauthGrant.clientId,
      scopes: oauthGrant.scopes,
      expiresAt: oauthGrant.accessExpiresAt,
    })
    .from(oauthGrant)
    .where(and(eq(oauthGrant.accessHash, hashToken(raw)), gt(oauthGrant.accessExpiresAt, now), live()))
    .limit(1);
  if (!row?.expiresAt) return null;
  return { id: row.id, name: row.name, clientId: row.clientId, scopes: row.scopes as McpScope[], expiresAt: row.expiresAt };
}

/** One grant as the devices page lists it: never a hash. */
export type GrantRow = {
  id: string;
  name: string;
  clientId: string;
  scopes: McpScope[];
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};

/** Every grant whose code was redeemed (so: every connection that ever existed), newest first. */
export async function listGrants(): Promise<GrantRow[]> {
  const rows = await db
    .select({
      id: oauthGrant.id,
      name: oauthGrant.name,
      clientId: oauthGrant.clientId,
      scopes: oauthGrant.scopes,
      createdAt: oauthGrant.createdAt,
      lastSeenAt: oauthGrant.lastSeenAt,
      revokedAt: oauthGrant.revokedAt,
    })
    .from(oauthGrant)
    .where(and(isNotNull(oauthGrant.codeUsedAt), isNull(oauthGrant.deletedAt)))
    .orderBy(desc(oauthGrant.createdAt));
  return rows.map((row) => ({ ...row, scopes: row.scopes as McpScope[] }));
}

/**
 * Revoke a grant. Immediate everywhere: `/mcp` looks the access token up on every request, and the
 * token endpoint refuses its refresh token. Returns false if no live grant has that id.
 */
export async function revokeGrant(id: string): Promise<boolean> {
  const [row] = await db
    .update(oauthGrant)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthGrant.id, id), live()))
    .returning({ id: oauthGrant.id });
  return Boolean(row);
}

/** Best-effort "last used" stamp, after the response; outside a request it is a detached write. */
export function touchGrantSeen(id: string): void {
  const stamp = () =>
    db
      .update(oauthGrant)
      .set({ lastSeenAt: new Date() })
      .where(eq(oauthGrant.id, id))
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
