import type { NextRequest } from "next/server";
import { requirePublisherToken } from "@/lib/auth/tokens";
import { attribute } from "@/lib/garage/repo";
import { attributeSchema } from "@/lib/garage/schema";
import { parseJson } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";

/**
 * POST /api/garage/rides/attribute — apply the profile rules to a batch of rides, each with its
 * facts copied in (the garage never reads the rides module, CONVENTIONS §9). Idempotent.
 *
 * AUTH: one of the three routes that accept `JMW_PUBLISHER_TOKEN` (via `requirePublisherToken`),
 * so the Garmin daemon can tag what it just uploaded. It's a push of facts the daemon already
 * holds; it can't read a tag back, edit one, or touch a manual tag (docs/garage-model.md).
 */
export async function POST(request: NextRequest) {
  const auth = requirePublisherToken(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, attributeSchema);
  if (!parsed.ok) return parsed.response;
  return ok(await attribute(parsed.data.rides));
}
