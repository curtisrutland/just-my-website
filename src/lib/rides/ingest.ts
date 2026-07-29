import { getRideFile, putRideFile, rideBlobKey } from "./blob";
import { decodeFitRide } from "./fit";
import { createRideFromFit, findExisting, getRide, getRideStorageRow, reprocessRide, rideToView } from "./repo";
import { fitRideSchema } from "./schema";
import type { IngestResult, RideDetail } from "./types";

/**
 * The ONE ingestion pipeline — however the bytes arrive (API upload route in v1, the web
 * server action, the v2 daemon), they pass through here:
 *
 *   bytes → decode (fit.ts) → fitRideSchema.parse → dedupe → Blob put → repo insert
 *
 * The kernel rule survives the binary input: no write path skips validation. Blob-then-DB
 * ordering: a crash between the two strands an orphan blob, which is harmless — the retry
 * writes the same deterministic key and completes the row.
 */

/** Ingest one FIT file. Throws `FitDecodeError` (→ 400) on undecodable/multi-session input. */
export async function ingestFitFile(bytes: Buffer): Promise<IngestResult> {
  const parsed = fitRideSchema.parse(decodeFitRide(bytes));
  const existing = await findExisting(parsed.fileHash, parsed.startedAt, parsed.deviceSerial);
  if (existing) return { ride: rideToView(existing), deduped: true };
  const key = rideBlobKey(parsed.fileHash);
  await putRideFile(key, bytes);
  const row = await createRideFromFit(parsed, key);
  return { ride: rideToView(row), deduped: false };
}

export type ReprocessResult =
  | { status: "ok"; ride: RideDetail }
  | { status: "not_found" }
  | { status: "blob_missing" };

/**
 * Reprocess a ride from its stored raw file: re-decode → re-validate → rewrite the fact
 * columns + rebuild the stream in place. The corrections lever, and how history back-fills
 * when the parser learns new fields. Name/note are never touched.
 */
export async function reprocessRideFromBlob(id: string): Promise<ReprocessResult> {
  const row = await getRideStorageRow(id);
  if (!row) return { status: "not_found" };
  const bytes = await getRideFile(row.blobKey);
  if (!bytes) return { status: "blob_missing" };
  const parsed = fitRideSchema.parse(decodeFitRide(bytes));
  const updated = await reprocessRide(id, parsed);
  if (!updated) return { status: "not_found" };
  const detail = await getRide(id, { includeStream: false });
  return detail ? { status: "ok", ride: detail } : { status: "not_found" };
}
