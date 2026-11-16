import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where responses are kept: infographics/.cache/http (gitignored). */
export const CACHE_DIR = join(__dirname, "..", "..", ".cache", "http");

/**
 * A `fetch` that keeps every successful GET on disk, so reworking a piece's data.ts does not
 * refetch every ride (docs/infographics.md §4). `refresh` skips the read and overwrites.
 *
 * It is also where "read-only" is enforced: anything but a GET is refused before it is sent.
 * The key is the full URL, so the local server and production never share an entry. The
 * Authorization header is never written.
 */
export function cachedFetch({ refresh = false, dir = CACHE_DIR }: { refresh?: boolean; dir?: string } = {}) {
  let hits = 0;
  let misses = 0;
  const cached = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (request.method !== "GET") {
      throw new Error(`infographics is read-only: refused ${request.method} ${request.url}`);
    }
    const key = createHash("sha256").update(request.url).digest("hex");
    const metaPath = join(dir, `${key}.json`);
    const bodyPath = join(dir, `${key}.body`);

    if (!refresh && existsSync(metaPath) && existsSync(bodyPath)) {
      hits += 1;
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { contentType: string };
      return new Response(readFileSync(bodyPath), { status: 200, headers: { "content-type": meta.contentType } });
    }

    misses += 1;
    const response = await fetch(request);
    if (response.status !== 200) return response; // errors are never cached
    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    mkdirSync(dir, { recursive: true });
    writeFileSync(bodyPath, body); // body first: an entry counts only once its meta exists
    writeFileSync(metaPath, JSON.stringify({ url: request.url, contentType, bytes: body.length, fetchedAt: new Date().toISOString() }));
    return new Response(body, { status: 200, headers: { "content-type": contentType } });
  };
  return Object.assign(cached, { stats: () => ({ hits, misses }) });
}
