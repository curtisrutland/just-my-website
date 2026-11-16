import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { FORMATS, type FormatName } from "../src/kit/formats";
import { pieceOfComposition, PIECES_DIR } from "./pieces";

/**
 * npm run still  -- <composition> [--frame N] [remotion flags]
 * npm run render -- <composition> [remotion flags]
 *
 * Renders one composition (named <slug>-<format>) to out/<piece>/ (docs/infographics.md §7).
 * Anything after the composition is passed through to the Remotion CLI.
 */
const [kind, id, ...rest] = process.argv.slice(2);
if (kind !== "still" && kind !== "video") {
  console.error("Usage: render.ts still|video <composition> [flags]");
  process.exit(1);
}
const { piece, format } = pieceOfComposition(id);
if (!(format in FORMATS)) {
  console.error(`"${format}" is not a format. Formats: ${Object.keys(FORMATS).join(", ")}`);
  process.exit(1);
}
if (!existsSync(join(PIECES_DIR, piece, "data.json"))) {
  console.error(`${piece} has no snapshot yet. Run: npm run data -- ${piece}`);
  process.exit(1);
}

const frameAt = rest.indexOf("--frame");
const frame = frameAt === -1 ? null : rest[frameAt + 1];
const passthrough = frameAt === -1 ? rest : [...rest.slice(0, frameAt), ...rest.slice(frameAt + 2)];
const outDir = join(__dirname, "..", "out", piece);
mkdirSync(outDir, { recursive: true });

const scale = FORMATS[format as FormatName].scale;
const args =
  kind === "still"
    ? ["remotion", "still", id, join(outDir, `${id}${frame === null ? "" : `-f${frame}`}.png`), `--frame=${frame ?? 0}`]
    : ["remotion", "render", id, join(outDir, passthrough.includes("--sequence") ? `${id}-frames` : `${id}.mp4`)];
const result = spawnSync("npx", [...args, `--scale=${scale}`, ...passthrough], { cwd: join(__dirname, ".."), stdio: "inherit" });
process.exit(result.status ?? 1);
