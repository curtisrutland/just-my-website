import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApi } from "../src/data/client";
import { fullResolution } from "../src/data/fit";
import type { PieceData } from "../src/data/piece";
import type { Frozen } from "../src/kit/snapshot";
import { PIECES_DIR, resolvePiece } from "./pieces";

/**
 * npm run data -- <piece> [--refresh]
 *
 * Runs the piece's data.ts (fetch, shape) and freezes what it returns to pieces/<piece>/data.json
 * (docs/infographics.md §4). A composition reads only that file.
 */
async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const piece = resolvePiece(args.find((a) => !a.startsWith("--")));
  const api = createApi({ refresh });
  console.log(`${piece}: reading ${api.baseUrl}${refresh ? " (refreshing the cache)" : ""}`);

  const build = ((await import(join(PIECES_DIR, piece, "data.ts"))) as { default: PieceData<unknown> }).default;
  const data = await build({ api, fit: (rideId) => fullResolution(api, rideId), log: (line) => console.log(`  ${line}`) });

  const frozen: Frozen<unknown> = { piece, frozenAt: new Date().toISOString(), source: api.baseUrl, data };
  const json = JSON.stringify(frozen);
  writeFileSync(join(PIECES_DIR, piece, "data.json"), json);
  const { hits, misses } = api.cacheStats();
  console.log(`${piece}: froze data.json (${(json.length / 1024).toFixed(0)} KB; ${misses} fetched, ${hits} from cache)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
