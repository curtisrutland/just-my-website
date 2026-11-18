import { originFrom } from "@/lib/auth/pairing";
import { authorizationServerMetadata } from "@/lib/mcp/oauth";
import { metadataJson, metadataPreflight } from "@/lib/mcp/responses";

/** RFC 8414 authorization server metadata (`docs/mcp.md` §2). Public by design; holds no data. */
export function GET(request: Request): Response {
  return metadataJson(authorizationServerMetadata(originFrom(request.headers)));
}

export const OPTIONS = metadataPreflight;
