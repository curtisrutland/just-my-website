import * as z from "zod";

/**
 * Response-contract building blocks shared by every module's view schemas (CONVENTIONS §4, §8).
 * Views describe the JSON a route actually sends — so instants are ISO strings (a `Date` serializes
 * to `2026-10-21T20:03:27.225Z`), never `Date`s. Views are plain `z.object`s, not `.strict()`: the
 * published OpenAPI stays open to additive fields (clients must tolerate them), while the contract
 * test (`src/lib/http/contract.test.ts`) still fails on any field a view doesn't declare.
 */

export const isoInstant = z.iso.datetime();
export const calendarDate = z.iso.date();

/** The audit columns as they appear on routes that return a raw row. */
export const auditView = {
  id: z.uuid(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
  deletedAt: isoInstant.nullable(),
};

/** CONVENTIONS §4: `{ items, limit, offset, count }`. */
export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    limit: z.number().int(),
    offset: z.number().int(),
    count: z.number().int(),
  });
