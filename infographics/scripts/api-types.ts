import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Regenerate the typed API surface (docs/infographics.md §4): rebuild the site's OpenAPI specs
 * from its Zod schemas, then turn each into TypeScript under src/data/api/ (gitignored). A field
 * that changes in a module's schema then fails `npm run typecheck` here, not in a picture.
 */
const repo = join(__dirname, "..", "..");
const specs = join(repo, "openapi");
const out = join(__dirname, "..", "src", "data", "api");

execFileSync("npm", ["run", "-s", "openapi:build"], { cwd: repo, stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of readdirSync(specs).filter((f) => f.endsWith(".json")).sort()) {
  const target = join(out, `${basename(file, ".json")}.ts`);
  execFileSync("npx", ["openapi-typescript", join(specs, file), "-o", target], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`  ${basename(target)}`);
}
