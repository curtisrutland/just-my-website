import type { Api } from "./client";
import type { fullResolution } from "./fit";

/** What a piece's data.ts is handed by `npm run data`. */
export type PieceContext = {
  /** Typed, read-only, cached clients, one per module. */
  api: Api;
  /** A ride's full-resolution samples, from its raw FIT file. */
  fit: (rideId: string) => ReturnType<typeof fullResolution>;
  /** Progress lines for the terminal. */
  log: (line: string) => void;
};

/**
 * A piece's data.ts default-exports one of these: fetch, shape, and return the snapshot. The
 * runner freezes whatever it returns to data.json, so a piece cannot forget to (§4).
 */
export type PieceData<Snapshot> = (ctx: PieceContext) => Promise<Snapshot>;
