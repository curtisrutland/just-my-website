import { config } from "dotenv";

// Load local env (DATABASE_URL etc.) so integration tests can reach Neon, matching how
// drizzle.config.ts sources its credentials.
config({ path: ".env.local" });
