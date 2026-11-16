import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedFetch } from "./cache";
import { all } from "./client";

let dir: string;
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jmw-cache-"));
  network = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("cachedFetch — read-only", () => {
  it("refuses every method but GET before anything is sent", async () => {
    const fetch = cachedFetch({ dir });
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      await expect(fetch("https://x/api/rides/1", { method })).rejects.toThrow(/read-only/);
    }
    expect(network).not.toHaveBeenCalled();
  });
});

describe("cachedFetch — the disk cache", () => {
  it("fetches once, then answers from disk with the same body and type", async () => {
    const fetch = cachedFetch({ dir });
    const first = await fetch("https://x/api/rides?limit=1");
    const second = await fetch("https://x/api/rides?limit=1");
    expect(network).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual(await first.json());
    expect(second.headers.get("content-type")).toBe("application/json");
    expect(fetch.stats()).toEqual({ hits: 1, misses: 1 });
  });

  it("keys on the whole URL, so another query or another host is another entry", async () => {
    const fetch = cachedFetch({ dir });
    await fetch("https://x/api/rides?limit=1");
    await fetch("https://x/api/rides?limit=2");
    await fetch("http://localhost:3000/api/rides?limit=1");
    expect(network).toHaveBeenCalledTimes(3);
  });

  it("refetches and overwrites with refresh", async () => {
    await cachedFetch({ dir })("https://x/api/rides");
    await cachedFetch({ dir, refresh: true })("https://x/api/rides");
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("never caches an error", async () => {
    network.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const fetch = cachedFetch({ dir });
    expect((await fetch("https://x/api/rides/nope")).status).toBe(404);
    expect((await fetch("https://x/api/rides/nope")).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("keeps binary bodies byte for byte", async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    network.mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } }));
    const fetch = cachedFetch({ dir });
    await fetch("https://x/api/rides/1/fit");
    const again = new Uint8Array(await (await fetch("https://x/api/rides/1/fit")).arrayBuffer());
    expect(Array.from(again)).toEqual(Array.from(bytes));
  });

  it("never writes the Authorization header to disk", async () => {
    const fetch = cachedFetch({ dir });
    await fetch("https://x/api/rides", { headers: { authorization: "Bearer secret-token-value" } });
    const written = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(written).not.toContain("secret-token-value");
  });
});

describe("all — paging", () => {
  it("walks every page of a list", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    const page = vi.fn(async (limit: number, offset: number) => ({ items: rows.slice(offset, offset + limit), count: rows.length }));
    expect(await all(page)).toEqual(rows);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("stops on an empty page even if the count says more", async () => {
    const page = vi.fn(async () => ({ items: [] as number[], count: 10 }));
    expect(await all(page)).toEqual([]);
    expect(page).toHaveBeenCalledTimes(1);
  });
});
