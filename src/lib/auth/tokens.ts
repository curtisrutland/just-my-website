import { createHash, timingSafeEqual } from "node:crypto";
import { unauthorized } from "@/lib/http/errors";

/**
 * Token auth at the `/api` boundary (CONVENTIONS §2). Two bearer tokens, no anonymous/session path:
 *  - `JMW_API_KEY`   — "primary": full access, including hard DELETE.
 *  - `JMW_AGENT_TOKEN` — "agent": Claude's write token; accepted for GET/POST/PATCH/soft-delete,
 *    **structurally rejected for hard DELETE** here in the auth layer (not by caller good behavior).
 */
export type TokenKind = "primary" | "agent";

/** Constant-time string compare (hash to fixed length first, so length never leaks via timing). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function identify(token: string): TokenKind | null {
  const primary = process.env.JMW_API_KEY;
  const agent = process.env.JMW_AGENT_TOKEN;
  if (primary && safeEqual(token, primary)) return "primary";
  if (agent && safeEqual(token, agent)) return "agent";
  return null;
}

type AuthOk = { ok: true; kind: TokenKind };
type AuthFail = { ok: false; response: Response };

/** `bearerAuth`: either token. For reads and non-destructive writes. */
export function requireBearer(request: Request): AuthOk | AuthFail {
  const token = extractBearer(request);
  if (!token) return { ok: false, response: unauthorized("Missing bearer token") };
  const kind = identify(token);
  if (!kind) return { ok: false, response: unauthorized("Invalid token") };
  return { ok: true, kind };
}

/** `primaryKey`: `JMW_API_KEY` only. Required for hard DELETE; the agent token is rejected (401). */
export function requirePrimary(request: Request): AuthOk | AuthFail {
  const auth = requireBearer(request);
  if (!auth.ok) return auth;
  if (auth.kind !== "primary") {
    return { ok: false, response: unauthorized("This operation requires the primary key") };
  }
  return auth;
}

/**
 * The scoped third token (rides module, documented kernel departure — docs/rides-model.md):
 * `JMW_PUBLISHER_TOKEN` is the v2 daemon's credential and is accepted by EXACTLY ONE route,
 * `POST /api/rides/upload` — which calls this instead of `requireBearer`. It is deliberately
 * NOT added to `identify()`: the publisher token can never pass `requireBearer`/`requirePrimary`,
 * so it can't read, patch, or delete anything, anywhere. Least privilege: a leaked daemon box
 * can push FIT files and nothing else.
 */
export type UploadTokenKind = TokenKind | "publisher";
type UploadAuthOk = { ok: true; kind: UploadTokenKind };

export function requireUploadToken(request: Request): UploadAuthOk | AuthFail {
  const token = extractBearer(request);
  if (!token) return { ok: false, response: unauthorized("Missing bearer token") };
  const publisher = process.env.JMW_PUBLISHER_TOKEN;
  if (publisher && safeEqual(token, publisher)) return { ok: true, kind: "publisher" };
  return requireBearer(request);
}
