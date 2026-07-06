/**
 * Pagination (CONVENTIONS §4). List endpoints return:
 *   { "items": [ ], "limit": 50, "offset": 0, "count": 0 }
 * where `count` is the total matching the filters, ignoring limit/offset.
 */

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function toInt(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Parse `limit` (default 50, clamped 1–100) and `offset` (default 0, min 0) from query params. */
export function parsePagination(searchParams: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(Math.max(toInt(searchParams.get("limit"), DEFAULT_LIMIT), MIN_LIMIT), MAX_LIMIT);
  const offset = Math.max(toInt(searchParams.get("offset"), 0), 0);
  return { limit, offset };
}

export type PaginatedBody<T> = { items: T[]; limit: number; offset: number; count: number };

export function paginated<T>(items: T[], count: number, limit: number, offset: number): PaginatedBody<T> {
  return { items, limit, offset, count };
}
