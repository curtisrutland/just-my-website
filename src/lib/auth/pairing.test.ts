import { describe, expect, it } from "vitest";
import { originFrom, pairingPayload } from "./pairing";

describe("pairingPayload", () => {
  it("is the v1 JSON the app parses, with the base's trailing slash dropped", () => {
    expect(JSON.parse(pairingPayload({ base: "https://justmy.website/", token: "jmw_abc" }))).toEqual({
      v: 1,
      base: "https://justmy.website",
      token: "jmw_abc",
    });
  });

  it("carries a trimmed name, and omits a blank one", () => {
    expect(JSON.parse(pairingPayload({ base: "https://justmy.website", token: "jmw_abc", name: "  Curtis's iPhone " })).name).toBe(
      "Curtis's iPhone"
    );
    expect(JSON.parse(pairingPayload({ base: "https://justmy.website", token: "jmw_abc", name: "  " }))).not.toHaveProperty("name");
  });

  it("is not a URL, so the system Camera won't open it in Safari", () => {
    expect(() => new URL(pairingPayload({ base: "https://justmy.website", token: "jmw_abc" }))).toThrow();
  });
});

describe("originFrom", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("uses the forwarded proto and host behind Vercel", () => {
    expect(originFrom(h({ host: "internal", "x-forwarded-host": "justmy.website", "x-forwarded-proto": "https" }))).toBe(
      "https://justmy.website"
    );
  });
  it("is http for a local dev server, on localhost or the LAN", () => {
    expect(originFrom(h({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(originFrom(h({ host: "curtis-mbp.local:3000" }))).toBe("http://curtis-mbp.local:3000");
  });
  it("defaults to https for any other host", () => {
    expect(originFrom(h({ host: "justmy.website" }))).toBe("https://justmy.website");
  });
});
