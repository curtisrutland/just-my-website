import { staticFile } from "remotion";

/** A frozen snapshot as written by `npm run data` (docs/infographics.md §4). */
export type Frozen<T> = {
  piece: string;
  /** When it was frozen (ISO instant). */
  frozenAt: string;
  /** The API base URL it was read from. */
  source: string;
  data: T;
};

const loading = new Map<string, Promise<Frozen<unknown>>>();

/**
 * Load a piece's snapshot, once per browser tab. This is the only thing a composition reads: it
 * is a local file served from the piece's own folder, never the API.
 */
export function loadSnapshot<T>(piece: string): Promise<Frozen<T>> {
  let pending = loading.get(piece);
  if (!pending) {
    pending = fetch(staticFile(`${piece}/data.json`)).then((response) => {
      if (!response.ok) throw new Error(`${piece} has no snapshot. Run: npm run data -- ${piece}`);
      return response.json() as Promise<Frozen<unknown>>;
    });
    loading.set(piece, pending);
  }
  return pending as Promise<Frozen<T>>;
}
