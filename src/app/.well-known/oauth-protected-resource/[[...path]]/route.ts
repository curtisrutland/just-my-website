import { originFrom } from "@/lib/auth/pairing";
import { protectedResourceMetadata } from "@/lib/mcp/oauth";
import { metadataJson, metadataPreflight } from "@/lib/mcp/responses";

/**
 * RFC 9728 protected resource metadata for `/mcp` (`docs/mcp.md` §2). Public by design: it holds no
 * data, only where to sign in. Served at `/.well-known/oauth-protected-resource/mcp` (the form the
 * 401 from `/mcp` points at) and at the bare path, which some clients probe second. There is one
 * protected resource, so both answer the same.
 */
export function GET(request: Request): Response {
  return metadataJson(protectedResourceMetadata(originFrom(request.headers)));
}

export const OPTIONS = metadataPreflight;
