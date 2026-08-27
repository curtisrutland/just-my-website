import { describe, expect, it } from "vitest";
import { requireBearer, requirePrimary, requirePublisherToken } from "./tokens";

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

describe("requirePublisherToken (the one publisher-accepting check — rides upload + vitals push)", () => {
  it("accepts the publisher token", () => {
    const r = requirePublisherToken(req(`Bearer ${publisher}`));
    expect(r.ok && r.kind).toBe("publisher");
  });
  it("still accepts both JMW tokens", () => {
    expect(requirePublisherToken(req(`Bearer ${primary}`)).ok).toBe(true);
    expect(requirePublisherToken(req(`Bearer ${agent}`)).ok).toBe(true);
  });
  it("rejects a missing/unknown token", () => {
    expect(requirePublisherToken(req()).ok).toBe(false);
    expect(requirePublisherToken(req("Bearer nope")).ok).toBe(false);
  });
  it("the publisher token is structurally rejected EVERYWHERE else", () => {
    // Least privilege: the daemon credential can push facts and do nothing else, anywhere.
    expect(requireBearer(req(`Bearer ${publisher}`)).ok).toBe(false);
    expect(requirePrimary(req(`Bearer ${publisher}`)).ok).toBe(false);
  });

  it("cannot READ vitals — the routes it can reach are pushes only", () => {
    // The scope grew from one route to two (docs/vitals-model.md). Pushing a day of vitals is
    // allowed; reading one back is not, and that asymmetry is the whole point of the token.
    const read = new Request("https://x/api/vitals", { headers: { authorization: `Bearer ${publisher}` } });
    expect(requireBearer(read).ok).toBe(false);
    expect(requirePrimary(read).ok).toBe(false);
  });
});
