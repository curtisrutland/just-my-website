import { kv } from "./kv";

/**
 * Section version stamps (panel-contract §4). The panel polls `/api/panel/version`, compares each
 * number to what it last saw, and refetches only the section whose number moved. The values are
 * opaque monotonic integers (unix seconds); the panel never interprets them beyond "did it change".
 *
 * `bump()` is the sanctioned cross-module import the macros/weight/shopping repos make into `panel`
 * (AGENTS.md exception): version-bumping is inherently cross-cutting, so it lives here and the write
 * paths call it. It is fire-and-forget — a KV hiccup must NEVER fail the write that triggered it.
 */
export const PANEL_SECTIONS = ["health", "shopping", "recipe"] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number];

const key = (section: PanelSection) => `panel:v:${section}`;

export type PanelVersions = Record<PanelSection, number>;

/**
 * Move a section's version so the panel notices on its next poll. Call AFTER the DB write commits.
 * We `await` so the write actually reaches KV before a serverless function can freeze, but every
 * error is swallowed: a missed bump means "stale until the next change re-bumps or the poll catches
 * a sibling change" — annoying, never a failed write. Value is unix seconds (contract §4);
 * same-second collisions are harmless (the panel only needs to see the number moved).
 */
export async function bump(section: PanelSection): Promise<void> {
  try {
    const client = kv();
    if (!client) return; // KV unconfigured → degrade to "no bump"; never throw into a write path
    await client.set(key(section), Math.floor(Date.now() / 1000));
  } catch {
    // swallowed on purpose — see doc above
  }
}

/**
 * Read all three version keys in one round-trip — the entire version endpoint. Unset keys read as 0
 * (never bumped); the panel fetches every section once on initial load anyway, so a cold all-zeros
 * start is fine. KV-only: this path must never touch Neon (contract §4.1).
 */
export async function readVersions(): Promise<PanelVersions> {
  const client = kv();
  if (!client) return { health: 0, shopping: 0, recipe: 0 };
  const vals = await client.mget<(number | string | null)[]>(...PANEL_SECTIONS.map(key));
  const out = {} as PanelVersions;
  PANEL_SECTIONS.forEach((s, i) => {
    out[s] = Number(vals[i] ?? 0) || 0;
  });
  return out;
}
