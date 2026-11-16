import { config } from "dotenv";
import { join } from "node:path";

// The same source scripts/build-skills.mjs uses: the repo's .env.local (docs/infographics.md §4).
config({ path: join(__dirname, "..", "..", "..", ".env.local"), quiet: true });

/** Production by default, because that is where the data is. `JMW_BASE_URL` overrides it. */
export const BASE_URL = (process.env.JMW_BASE_URL || "https://justmy.website").replace(/\/$/, "");

/** The agent token: reads everything, structurally unable to hard-delete. */
export function agentToken(): string {
  const token = process.env.JMW_AGENT_TOKEN;
  if (!token) throw new Error("JMW_AGENT_TOKEN is not set (expected in the repo's .env.local)");
  return token;
}
