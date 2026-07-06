import { config } from "dotenv";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Injects the agent token + API base URL into the skill's placeholders, producing a built copy
// under skills/dist/ (gitignored — it contains the secret). At deploy, set JMW_BASE_URL to the
// production URL; locally it defaults to the dev server.
config({ path: ".env.local" });

const token = process.env.JMW_AGENT_TOKEN;
const baseUrl = (process.env.JMW_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!token) {
  console.error("JMW_AGENT_TOKEN is not set (need it to build the skill).");
  process.exit(1);
}

const SKILLS = ["manage-macros"];
const distRoot = "skills/dist";
rmSync(distRoot, { recursive: true, force: true });

for (const name of SKILLS) {
  const srcDir = join("skills", name);
  const outDir = join(distRoot, name);
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    const content = readFileSync(join(srcDir, file), "utf8")
      .replaceAll("__JMW_BASE_URL__", baseUrl)
      .replaceAll("__JMW_AGENT_TOKEN__", token);
    writeFileSync(join(outDir, file), content);
  }
  // Package the skill folder into a zip for upload to claude.ai (SKILL.md at manage-macros/ root).
  execSync(`zip -r -q "${name}.zip" "${name}"`, { cwd: distRoot });
  console.log(`Built skill "${name}" → ${outDir} (+ ${join(distRoot, `${name}.zip`)})`);
}
console.log(`Base URL: ${baseUrl}`);
