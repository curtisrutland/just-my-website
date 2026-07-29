import { describe, expect, it } from "vitest";
import { requireBearer, requirePrimary, requireUploadToken } from "./tokens";

// Tokens loaded from .env.local by vitest.setup.ts.
const primary = process.env.JMW_API_KEY!;
const agent = process.env.JMW_AGENT_TOKEN!;
const publisher = process.env.JMW_PUBLISHER_TOKEN!;

const req = (authorization?: string) =>
  new Request("https://x/api/macros/foods", authorization ? { headers: { authorization } } : undefined);

describe("requireBearer (either token)", () => {
  it("rejects a missing Authorization header", () => {
    expect(requireBearer(req()).ok).toBe(false);
  });
  it("rejects an unknown token", () => {
    expect(requireBearer(req("Bearer not-a-real-token")).ok).toBe(false);
  });
  it("accepts the primary key", () => {
    const r = requireBearer(req(`Bearer ${primary}`));
    expect(r.ok && r.kind).toBe("primary");
  });
  it("accepts the agent token", () => {
    const r = requireBearer(req(`Bearer ${agent}`));
    expect(r.ok && r.kind).toBe("agent");
  });
});

describe("requirePrimary (primary key only)", () => {
  it("accepts the primary key", () => {
    expect(requirePrimary(req(`Bearer ${primary}`)).ok).toBe(true);
  });
  it("structurally rejects the agent token with 401", () => {
    const r = requirePrimary(req(`Bearer ${agent}`));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
  it("rejects a missing token", () => {
    expect(requirePrimary(req()).ok).toBe(false);
  });
});

describe("requireUploadToken (the one publisher-accepting check — rides upload only)", () => {
  it("accepts the publisher token", () => {
    const r = requireUploadToken(req(`Bearer ${publisher}`));
    expect(r.ok && r.kind).toBe("publisher");
  });
  it("still accepts both JMW tokens", () => {
    expect(requireUploadToken(req(`Bearer ${primary}`)).ok).toBe(true);
    expect(requireUploadToken(req(`Bearer ${agent}`)).ok).toBe(true);
  });
  it("rejects a missing/unknown token", () => {
    expect(requireUploadToken(req()).ok).toBe(false);
    expect(requireUploadToken(req("Bearer nope")).ok).toBe(false);
  });
  it("the publisher token is structurally rejected EVERYWHERE else", () => {
    // Least privilege: the daemon credential can push files and do nothing else, anywhere.
    expect(requireBearer(req(`Bearer ${publisher}`)).ok).toBe(false);
    expect(requirePrimary(req(`Bearer ${publisher}`)).ok).toBe(false);
  });
});
