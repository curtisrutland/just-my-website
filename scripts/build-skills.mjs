import { config } from "dotenv";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Injects the agent token + API base URL into the skill's placeholders, producing a built copy
// under skills/dist/ (gitignored — it contains the secret). The zips are for UPLOAD to claude.ai,
// so the base URL defaults to PRODUCTION. Set JMW_BASE_URL=http://localhost:3000 only to build a
// zip for testing against a local dev server (that zip will not work off your machine).
const DEFAULT_BASE_URL = "https://justmy.website";
config({ path: ".env.local" });

const token = process.env.JMW_AGENT_TOKEN;
const baseUrl = (process.env.JMW_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
if (!token) {
  console.error("JMW_AGENT_TOKEN is not set (need it to build the skill).");
  process.exit(1);
}
if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
  console.warn(`⚠️  Building against a LOCAL base URL (${baseUrl}). This zip only works on your machine —`);
  console.warn(`   unset JMW_BASE_URL (or set it to ${DEFAULT_BASE_URL}) before building a zip to upload to claude.ai.`);
}

const SKILLS = ["manage-macros", "manage-weight", "manage-shopping", "manage-lifting"];
const distRoot = "skills/dist";
rmSync(distRoot, { recursive: true, force: true });

// Only real source files belong in the built skill. Skip directories (e.g. Python's `__pycache__`,
// created just by importing client.py) and local junk (dotfiles like .DS_Store, compiled `.pyc`) —
// otherwise the copy loop crashes on a dir and/or that junk gets bundled into the upload zip.
const isIgnored = (fileName) => fileName.startsWith(".") || fileName.endsWith(".pyc");

for (const name of SKILLS) {
  const srcDir = join("skills", name);
  const outDir = join(distRoot, name);
  mkdirSync(outDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || isIgnored(entry.name)) continue;
    const content = readFileSync(join(srcDir, entry.name), "utf8")
      .replaceAll("__JMW_BASE_URL__", baseUrl)
      .replaceAll("__JMW_AGENT_TOKEN__", token);
    writeFileSync(join(outDir, entry.name), content);
  }
  // Package the skill folder into a zip for upload to claude.ai (SKILL.md at manage-macros/ root).
  execSync(`zip -r -q "${name}.zip" "${name}"`, { cwd: distRoot });
  console.log(`Built skill "${name}" → ${outDir} (+ ${join(distRoot, `${name}.zip`)})`);
}
console.log(`Base URL: ${baseUrl}`);
