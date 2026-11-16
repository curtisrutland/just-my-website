import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const PIECES_DIR = join(__dirname, "..", "pieces");

/** "2026-11-sample-ride" → "sample-ride". */
export const slugOf = (folder: string): string => folder.replace(/^\d{4}-\d{2}-/, "");

const folders = (): string[] =>
  readdirSync(PIECES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PIECES_DIR, d.name, "brief.md")))
    .map((d) => d.name);

const fail = (message: string): never => {
  console.error(`${message}\nPieces: ${folders().join(", ") || "(none)"}`);
  process.exit(1);
};

/** A piece folder from its folder name or its slug. */
export function resolvePiece(name: string | undefined): string {
  if (!name) return fail("Name a piece.");
  const match = folders().filter((f) => f === name || slugOf(f) === name);
  return match.length === 1 ? match[0] : fail(`No piece called "${name}".`);
}

/** The piece a composition belongs to, and its format: "sample-ride-wide" → sample-ride + wide. */
export function pieceOfComposition(id: string | undefined): { piece: string; format: string } {
  if (!id) return fail("Name a composition, as <slug>-<format>.");
  const match = folders()
    .filter((f) => id.startsWith(`${slugOf(f)}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (!match) return fail(`No piece owns the composition "${id}".`);
  return { piece: match, format: id.slice(slugOf(match).length + 1) };
}
