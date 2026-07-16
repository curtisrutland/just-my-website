import { Redis } from "@upstash/redis";

/**
 * The panel's KV store (Upstash Redis, provisioned via the Vercel Marketplace). This is the ONLY
 * datastore allowed on the version-poll hot path — panel-contract §4.1 forbids Neon there so the
 * Neon compute can autosuspend (otherwise the 60s poll bills 24/7, see §9).
 *
 * Lazily constructed and env-guarded: if the connection vars are absent (a context without the
 * integration), `kv()` returns null and callers degrade (bump no-ops, reads fall back / return
 * zeros) instead of throwing at import time. The Marketplace integration injects the `KV_*` names,
 * NOT the `UPSTASH_REDIS_REST_*` that `Redis.fromEnv()` expects — so we wire them explicitly.
 */
let cached: Redis | null | undefined;

export function kv(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  cached = url && token ? new Redis({ url, token }) : null;
  return cached;
}
