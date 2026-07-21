/**
 * Hevy public API client — a thin wrapper over the two read endpoints the lifting module needs, so
 * the repo/routes never hand-roll fetches (mirrors src/lib/usda/client.ts). Requires a Hevy PRO
 * account. Auth is an `api-key` request header (NOT a bearer token); the key lives in `HEVY_API_KEY`.
 *
 * Returns RAW `unknown` payloads on purpose — validation is the schema layer's job
 * (`hevyWorkoutSchema.parse`), keeping this client free of domain knowledge.
 */

const HEVY_BASE = "https://api.hevyapp.com/v1";

function apiKey(): string {
  const key = process.env.HEVY_API_KEY;
  if (!key) throw new Error("HEVY_API_KEY is not set");
  return key;
}

async function hevyGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${HEVY_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "api-key": apiKey(), accept: "application/json" },
    // Never cache — we always want Hevy's latest (a re-pull detects edits via updated_at).
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Hevy request failed: ${res.status} ${res.statusText} (${path})`);
  }
  return (await res.json()) as T;
}

/**
 * One full workout by id (the webhook trigger pulls this). Returns the raw workout object. Hevy's
 * single-workout endpoint may return the object directly or wrapped as `{ workout: {...} }`; we
 * unwrap defensively so the caller always gets the workout object to parse.
 */
export async function getWorkout(workoutId: string): Promise<unknown> {
  const body = await hevyGet<unknown>(`/workouts/${encodeURIComponent(workoutId)}`);
  if (body && typeof body === "object" && "workout" in body) {
    return (body as { workout: unknown }).workout;
  }
  return body;
}

/** One page of workouts. Hevy pages by `page` / `page_size`; the envelope is `{ page, page_count, workouts }`. */
export type HevyWorkoutPage = {
  page: number;
  pageCount: number;
  /** Raw workout objects — parsed by the caller. */
  workouts: unknown[];
};

/** Hevy caps `page_size` at 10 on this endpoint; keep the default there and page by `page`. */
export async function listWorkouts(opts: { page?: number; pageSize?: number } = {}): Promise<HevyWorkoutPage> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 10;
  const body = await hevyGet<{ page?: number; page_count?: number; workouts?: unknown[] }>("/workouts", {
    page: String(page),
    page_size: String(pageSize),
  });
  return {
    page: body.page ?? page,
    pageCount: body.page_count ?? 1,
    workouts: body.workouts ?? [],
  };
}
