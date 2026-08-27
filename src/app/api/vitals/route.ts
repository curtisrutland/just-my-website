import type { NextRequest } from "next/server";
import { requireBearer, requirePublisherToken } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { created, ok } from "@/lib/http/responses";
import { isValidDate } from "@/lib/http/params";
import { listDays, upsertDay } from "@/lib/vitals/repo";
import { vitalsDaySchema, vitalsIngestSchema } from "@/lib/vitals/schema";
import { normalizeGarminDay } from "@/lib/vitals/normalize";

/** GET — the day list. `from`/`to` narrow the range; same view shape as the detail read (#40). */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);
  const from = sp.get("from");
  const to = sp.get("to");
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    return ok(paginated([], 0, limit, offset));
  }
  const { items, count } = await listDays({ limit, offset, from: from ?? undefined, to: to ?? undefined });
  return ok(paginated(items, count, limit, offset));
}

/**
 * POST — the Garmin daemon pushes one day. The SECOND of exactly two routes that accept
 * `JMW_PUBLISHER_TOKEN` (docs/vitals-model.md § "Kernel departure"); the daemon can push facts
 * here and read nothing back, anywhere.
 *
 * Upsert, not create: Garmin revises a day after the fact, so the daemon re-polls a trailing window
 * and the newest poll replaces the row wholesale. `201` the first time a day is seen, `200` after —
 * re-pushing is the normal case, not an error.
 */
export async function POST(request: NextRequest) {
  const auth = requirePublisherToken(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, vitalsIngestSchema);
  if (!parsed.ok) return parsed.response;
  // decode -> validate -> repo. The normalizer is the only place a Garmin field acquires meaning,
  // and reprocess replays this exact step over the stored payload.
  const day = vitalsDaySchema.parse(normalizeGarminDay(parsed.data.measuredOn, parsed.data.raw));
  const { row, created: isNew } = await upsertDay(day);
  const location = `/api/vitals/${row.measuredOn}`;
  return isNew ? created({ measuredOn: row.measuredOn, created: true }, location) : ok({ measuredOn: row.measuredOn, created: false }, { headers: { Location: location } });
}
