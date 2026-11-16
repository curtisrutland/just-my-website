import createClient from "openapi-fetch";
import type { paths as GaragePaths } from "./api/garage";
import type { paths as LiftingPaths } from "./api/lifting";
import type { paths as MacrosPaths } from "./api/macros";
import type { paths as RidesPaths } from "./api/rides";
import type { paths as ShoppingPaths } from "./api/shopping";
import type { paths as VitalsPaths } from "./api/vitals";
import type { paths as WeightPaths } from "./api/weight";
import { cachedFetch } from "./cache";
import { agentToken, BASE_URL } from "./env";

/**
 * The one way a piece reads data (docs/infographics.md §4): a client per module, typed from the
 * generated OpenAPI spec, exposing GET and nothing else. Run `npm run api:types` after an API
 * change so these types are current.
 */
export function createApi({ refresh = false }: { refresh?: boolean } = {}) {
  const fetch = cachedFetch({ refresh });
  const headers = { authorization: `Bearer ${agentToken()}` };
  // Only GET leaves this function; the fetch underneath refuses every other method as well.
  const module = <Paths extends {}>() => ({ GET: createClient<Paths>({ baseUrl: BASE_URL, headers, fetch }).GET });
  return {
    baseUrl: BASE_URL,
    cacheStats: fetch.stats,
    garage: module<GaragePaths>(),
    lifting: module<LiftingPaths>(),
    macros: module<MacrosPaths>(),
    rides: module<RidesPaths>(),
    shopping: module<ShoppingPaths>(),
    vitals: module<VitalsPaths>(),
    weight: module<WeightPaths>(),
  };
}

export type Api = ReturnType<typeof createApi>;

/** The data of a GET, or a thrown error that names the request and the API's own message. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data === undefined || !result.response.ok) {
    const detail = result.error === undefined ? "" : ` ${JSON.stringify(result.error)}`;
    throw new Error(`${result.response.status} from ${result.response.url || "the API"}${detail}`);
  }
  return result.data;
}

/** Every item of a paginated list (the API's page size tops out at 100). */
export async function all<T>(page: (limit: number, offset: number) => Promise<{ items: T[]; count: number }>): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const { items: batch, count } = await page(100, offset);
    items.push(...batch);
    if (batch.length === 0 || items.length >= count) return items;
  }
}
