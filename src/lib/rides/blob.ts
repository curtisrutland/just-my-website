import { del, get, put } from "@vercel/blob";

/**
 * The raw-FIT store (Vercel Blob, private). The Blob is the module's lossless source — the
 * `rawPayload` analog from lifting, one level rawer: the exact bytes the device produced,
 * reprocessable forever. Keys are DETERMINISTIC (`rides/<sha256>.fit`) so a crashed ingest
 * retries idempotently, overwriting the same key instead of stranding a second copy.
 */

export const rideBlobKey = (fileHash: string): string => `rides/${fileHash}.fit`;

/** Store the raw FIT bytes. Overwrite-allowed on purpose (deterministic key = idempotent retry). */
export async function putRideFile(key: string, bytes: Buffer): Promise<void> {
  await put(key, bytes, { access: "private", allowOverwrite: true });
}

/** Read the raw FIT back (reprocess path). Returns null when the blob is missing. */
export async function getRideFile(key: string): Promise<Buffer | null> {
  const result = await get(key, { access: "private" });
  if (!result || result.stream == null) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

/** Remove the raw file (hard delete only — soft-deleted rides keep their blob). */
export async function deleteRideFile(key: string): Promise<void> {
  await del(key);
}
