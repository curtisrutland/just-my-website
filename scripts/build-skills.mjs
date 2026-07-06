import { config } from "dotenv";
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
  console.log(`Built skill "${name}" → ${outDir}`);
}
console.log(`Base URL: ${baseUrl}`);
