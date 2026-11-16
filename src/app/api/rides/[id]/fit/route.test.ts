import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { openRideFile } from "@/lib/rides/blob";
import { getRideStorageRow, listRides } from "@/lib/rides/repo";
import { GET } from "./route";

// The real Blob read by default; one test below makes a single call report a missing file.
vi.mock("@/lib/rides/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rides/blob")>();
  return { ...actual, openRideFile: vi.fn(actual.openRideFile) };
});

/**
 * GET /api/rides/{id}/fit against the real handler (docs/rides-model.md). The token cases stop at
 * auth or at a ride id that doesn't exist. The download cases are integration reads against live
 * Neon and Blob, like the repo tests: they use the newest ride already in the log, change nothing,
 * and are skipped when the log is empty.
 */
const NIL = "00000000-0000-0000-0000-000000000000";
const get = (id: string, token?: string) =>
  GET(new NextRequest(`https://x/api/rides/${id}/fit`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined), {
    params: Promise.resolve({ id }),
  });

const newestRide = async () => {
  const { items } = await listRides({ limit: 1, offset: 0 });
  return items[0] ? getRideStorageRow(items[0].id) : null;
};

describe("GET /api/rides/{id}/fit — who may download", () => {
  it("accepts the primary key and the agent token (an unknown ride is a 404, not a 401)", async () => {
    expect((await get(NIL, process.env.JMW_API_KEY!)).status).toBe(404);
    expect((await get(NIL, process.env.JMW_AGENT_TOKEN!)).status).toBe(404);
  });

  it("rejects the publisher token, the display token, an unknown token and no token", async () => {
    const display = (process.env.JMW_DISPLAY_TOKEN ||= "jmw_test_display_token");
    for (const token of [process.env.JMW_PUBLISHER_TOKEN!, display, "nope", undefined]) {
      expect((await get(NIL, token)).status).toBe(401);
    }
  });
});

describe("GET /api/rides/{id}/fit — the file", () => {
  it("returns the stored bytes unchanged, with a filename and never a wrong length", async ({ skip }) => {
    const row = await newestRide();
    if (!row) return skip();
    const res = await get(row.id, process.env.JMW_AGENT_TOKEN!);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());

    // The ride's fileHash is the SHA-256 taken at ingest, so a match means byte-for-byte.
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(row.fileHash);
    expect(bytes.subarray(8, 12).toString("ascii")).toBe(".FIT");
    // Storage doesn't always state the size; the header is then left off, never sent as 0.
    expect([null, String(bytes.length)]).toContain(res.headers.get("content-length"));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${row.localDate}-${row.id}.fit"`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("says nothing about where the file is stored", async ({ skip }) => {
    const row = await newestRide();
    if (!row) return skip();
    const res = await get(row.id, process.env.JMW_AGENT_TOKEN!);
    const headers = [...res.headers].flat().join(" ");
    expect(headers).not.toContain(row.blobKey);
    expect(headers).not.toContain(row.fileHash);
    await res.body?.cancel();
  });

  it("answers 409 when the ride exists but its file is missing from storage", async ({ skip }) => {
    const row = await newestRide();
    if (!row) return skip();
    vi.mocked(openRideFile).mockResolvedValueOnce(null);
    const res = await get(row.id, process.env.JMW_AGENT_TOKEN!);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });
});
